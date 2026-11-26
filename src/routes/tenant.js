import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireFeature, requireTenant } from "../middleware/tenant.js";
import { AppError, asyncHandler, validate } from "../utils/errors.js";
import { recordAudit } from "../utils/audit.js";

const router = Router();
router.use(requireAuth, requireTenant);

const createProjectSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional().default(""),
});

const updateProjectSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const createWebhookSchema = z.object({
  url: z.string().url(),
  event: z.enum(["project.created", "project.updated", "project.deleted", "user.invited"]),
});

const createUserSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["TENANT_ADMIN", "TENANT_USER"]).default("TENANT_USER"),
});

// --- Projects (Feature: projects) ---
router.get(
  "/projects",
  requireFeature("projects"),
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    res.json({ tenantId: req.tenantId, projects });
  })
);

router.post(
  "/projects",
  requireFeature("projects"),
  validate(createProjectSchema),
  asyncHandler(async (req, res) => {
    const project = await prisma.project.create({
      data: {
        tenantId: req.tenantId,
        name: req.body.name.trim(),
        description: req.body.description.trim(),
        createdById: req.user.id,
      },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "project.created",
      resource: `project:${project.id}`,
      meta: { name: project.name },
    });

    res.status(201).json({ project });
  })
);

router.patch(
  "/projects/:id",
  requireFeature("projects"),
  validate(updateProjectSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found in this tenant workspace.");
    }

    const project = await prisma.project.update({
      where: { id: existing.id },
      data: {
        ...(req.body.name !== undefined ? { name: req.body.name.trim() } : {}),
        ...(req.body.description !== undefined ? { description: req.body.description.trim() } : {}),
        ...(req.body.status !== undefined ? { status: req.body.status } : {}),
      },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "project.updated",
      resource: `project:${project.id}`,
      meta: req.body,
    });

    res.json({ project });
  })
);

router.delete(
  "/projects/:id",
  requireFeature("projects"),
  requireRole("SUPER_ADMIN", "TENANT_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found in this tenant workspace.");
    }

    await prisma.project.delete({ where: { id: existing.id } });
    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "project.deleted",
      resource: `project:${existing.id}`,
      meta: { name: existing.name },
    });

    res.status(204).send();
  })
);

// --- Analytics (Feature: analytics) ---
router.get(
  "/analytics",
  requireFeature("analytics"),
  asyncHandler(async (req, res) => {
    const [totalProjects, activeProjects, archivedProjects, totalUsers, totalWebhooks, recentLogs] =
      await Promise.all([
        prisma.project.count({ where: { tenantId: req.tenantId } }),
        prisma.project.count({ where: { tenantId: req.tenantId, status: "active" } }),
        prisma.project.count({ where: { tenantId: req.tenantId, status: "archived" } }),
        prisma.user.count({ where: { tenantId: req.tenantId } }),
        prisma.webhook.count({ where: { tenantId: req.tenantId } }),
        prisma.auditLog.count({ where: { tenantId: req.tenantId } }),
      ]);

    res.json({
      tenant: { id: req.tenant.id, slug: req.tenant.slug, name: req.tenant.name },
      plan: req.tenant.plan.code,
      metrics: {
        totalProjects,
        activeProjects,
        archivedProjects,
        totalUsers,
        totalWebhooks,
        auditEvents: recentLogs,
      },
    });
  })
);

// --- Webhooks (Feature: webhooks) ---
router.get(
  "/webhooks",
  requireFeature("webhooks"),
  asyncHandler(async (req, res) => {
    const webhooks = await prisma.webhook.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ webhooks });
  })
);

router.post(
  "/webhooks",
  requireFeature("webhooks"),
  requireRole("SUPER_ADMIN", "TENANT_ADMIN"),
  validate(createWebhookSchema),
  asyncHandler(async (req, res) => {
    const webhook = await prisma.webhook.create({
      data: {
        tenantId: req.tenantId,
        url: req.body.url,
        event: req.body.event,
        active: true,
      },
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "webhook.created",
      resource: `webhook:${webhook.id}`,
      meta: { event: webhook.event, url: webhook.url },
    });

    res.status(201).json({ webhook });
  })
);

router.delete(
  "/webhooks/:id",
  requireFeature("webhooks"),
  requireRole("SUPER_ADMIN", "TENANT_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.webhook.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) throw new AppError(404, "WEBHOOK_NOT_FOUND", "Webhook not found in this tenant.");

    await prisma.webhook.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

// --- Team Members (Feature: team_invites for creation) ---
router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    res.json({ users });
  })
);

router.post(
  "/users",
  requireFeature("team_invites"),
  requireRole("SUPER_ADMIN", "TENANT_ADMIN"),
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const user = await prisma.user.create({
      data: {
        tenantId: req.tenantId,
        name: req.body.name.trim(),
        email: req.body.email.trim().toLowerCase(),
        passwordHash,
        role: req.body.role,
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "user.invited",
      resource: `user:${user.id}`,
      meta: { email: user.email, role: user.role },
    });

    res.status(201).json({ user });
  })
);

// --- Audit Logs (Feature: audit_logs) ---
router.get(
  "/audit-logs",
  requireFeature("audit_logs"),
  asyncHandler(async (req, res) => {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
    });
    res.json({
      logs: logs.map((l) => ({
        ...l,
        meta: JSON.parse(l.meta || "{}"),
      })),
    });
  })
);

export default router;
