import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, signToken } from "../middleware/auth.js";
import { AppError, asyncHandler, validate } from "../utils/errors.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function formatTenantPayload(tenant) {
  if (!tenant) return null;
  return {
    id: tenant.id,
    slug: tenant.slug,
    codePrefix: tenant.codePrefix,
    name: tenant.name,
    status: tenant.status,
    plan: {
      id: tenant.plan.id,
      code: tenant.plan.code,
      name: tenant.plan.name,
      priceMonthly: tenant.plan.priceMonthly,
    },
    enabledFeatures: tenant.plan.features.filter((f) => f.enabled).map((f) => f.feature.key),
    features: tenant.plan.features.map((f) => ({
      key: f.feature.key,
      name: f.feature.name,
      description: f.feature.description,
      enabled: f.enabled,
    })),
  };
}

router.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const email = req.body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        tenant: {
          include: {
            plan: { include: { features: { include: { feature: true } } } },
          },
        },
      },
    });

    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
    }

    if (user.tenant && user.tenant.status !== "active") {
      throw new AppError(403, "TENANT_SUSPENDED", "This organization workspace is currently suspended.");
    }

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        title: user.title,
        role: user.role,
        tenantId: user.tenantId,
      },
      tenant: formatTenantPayload(user.tenant),
    });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        tenant: {
          include: {
            plan: { include: { features: { include: { feature: true } } } },
          },
        },
      },
    });

    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "Authenticated user no longer exists.");
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        title: user.title,
        role: user.role,
        tenantId: user.tenantId,
      },
      tenant: formatTenantPayload(user.tenant),
    });
  })
);

export default router;
