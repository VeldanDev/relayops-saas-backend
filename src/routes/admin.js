import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { AppError, asyncHandler, validate } from "../utils/errors.js";
import { recordAudit } from "../utils/audit.js";

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN"));

const toggleFeatureSchema = z.object({
  enabled: z.boolean(),
});

const createTenantSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, "Slug must contain lowercase letters, numbers, or hyphens"),
  planCode: z.string().min(2),
  adminName: z.string().min(2).max(80),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(6),
});

const updateTenantPlanSchema = z.object({
  planId: z.string().min(1),
});

const updateTenantStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
});

router.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const [plans, features] = await Promise.all([
      prisma.plan.findMany({
        orderBy: { priceMonthly: "asc" },
        include: {
          features: { include: { feature: true } },
          _count: { select: { tenants: true } },
        },
      }),
      prisma.feature.findMany({ orderBy: { key: "asc" } }),
    ]);

    res.json({
      features,
      plans: plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        priceMonthly: p.priceMonthly,
        tenantCount: p._count.tenants,
        features: Object.fromEntries(p.features.map((pf) => [pf.feature.key, pf.enabled])),
      })),
    });
  })
);

router.patch(
  "/plans/:planId/features/:featureKey",
  validate(toggleFeatureSchema),
  asyncHandler(async (req, res) => {
    const { planId, featureKey } = req.params;
    const [plan, feature] = await Promise.all([
      prisma.plan.findUnique({ where: { id: planId } }),
      prisma.feature.findUnique({ where: { key: featureKey } }),
    ]);

    if (!plan) throw new AppError(404, "PLAN_NOT_FOUND", "Subscription plan not found.");
    if (!feature) throw new AppError(404, "FEATURE_NOT_FOUND", `Unknown feature key '${featureKey}'.`);

    const updated = await prisma.planFeature.upsert({
      where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
      update: { enabled: req.body.enabled },
      create: { planId: plan.id, featureId: feature.id, enabled: req.body.enabled },
    });

    await recordAudit({
      tenantId: null,
      actorId: req.user.id,
      action: "plan.feature_toggled",
      resource: `plan:${plan.code}`,
      meta: { featureKey, enabled: updated.enabled },
    });

    res.json({
      planId: plan.id,
      planCode: plan.code,
      featureKey,
      enabled: updated.enabled,
    });
  })
);

router.get(
  "/tenants",
  asyncHandler(async (_req, res) => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        plan: { select: { id: true, code: true, name: true, priceMonthly: true } },
        _count: { select: { users: true, projects: true, webhooks: true } },
      },
    });
    res.json({ tenants });
  })
);

router.post(
  "/tenants",
  validate(createTenantSchema),
  asyncHandler(async (req, res) => {
    const plan = await prisma.plan.findUnique({ where: { code: req.body.planCode } });
    if (!plan) throw new AppError(404, "PLAN_NOT_FOUND", `Plan '${req.body.planCode}' not found.`);

    const passwordHash = await bcrypt.hash(req.body.adminPassword, 10);
    const created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: req.body.name.trim(),
          slug: req.body.slug.trim().toLowerCase(),
          planId: plan.id,
          status: "active",
        },
        include: { plan: { select: { id: true, code: true, name: true, priceMonthly: true } } },
      });

      const admin = await tx.user.create({
        data: {
          email: req.body.adminEmail.trim().toLowerCase(),
          passwordHash,
          name: req.body.adminName.trim(),
          role: "TENANT_ADMIN",
          tenantId: tenant.id,
        },
        select: { id: true, email: true, name: true, role: true, tenantId: true },
      });

      return { tenant, admin };
    });

    await recordAudit({
      tenantId: created.tenant.id,
      actorId: req.user.id,
      action: "tenant.created",
      resource: `tenant:${created.tenant.slug}`,
      meta: { planCode: plan.code, adminEmail: created.admin.email },
    });

    res.status(201).json(created);
  })
);

router.patch(
  "/tenants/:tenantId/plan",
  validate(updateTenantPlanSchema),
  asyncHandler(async (req, res) => {
    const [tenant, plan] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: req.params.tenantId } }),
      prisma.plan.findUnique({ where: { id: req.body.planId } }),
    ]);

    if (!tenant) throw new AppError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    if (!plan) throw new AppError(404, "PLAN_NOT_FOUND", "Plan not found.");

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { planId: plan.id },
      include: { plan: { select: { id: true, code: true, name: true, priceMonthly: true } } },
    });

    await recordAudit({
      tenantId: tenant.id,
      actorId: req.user.id,
      action: "tenant.plan_changed",
      resource: `tenant:${tenant.slug}`,
      meta: { fromPlanId: tenant.planId, toPlanCode: plan.code },
    });

    res.json({ tenant: updated });
  })
);

router.patch(
  "/tenants/:tenantId/status",
  validate(updateTenantStatusSchema),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
    if (!tenant) throw new AppError(404, "TENANT_NOT_FOUND", "Tenant not found.");

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: req.body.status },
      include: { plan: { select: { id: true, code: true, name: true, priceMonthly: true } } },
    });

    await recordAudit({
      tenantId: tenant.id,
      actorId: req.user.id,
      action: "tenant.status_changed",
      resource: `tenant:${tenant.slug}`,
      meta: { status: req.body.status },
    });

    res.json({ tenant: updated });
  })
);

export default router;
