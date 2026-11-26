import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../utils/errors.js";

/**
 * Resolves tenant context and enforces strict cross-tenant isolation.
 * - For TENANT_ADMIN / TENANT_USER, req.user.tenantId from the signed JWT is authoritative.
 * - If x-tenant-id or x-tenant-slug header is also sent, it MUST match the JWT tenant;
 *   any mismatch is rejected immediately with 403 CROSS_TENANT_FORBIDDEN.
 * - Always loads live plan features from the database so Super Admin toggles take effect instantly.
 */
export const requireTenant = asyncHandler(async (req, _res, next) => {
  const headerId = req.headers["x-tenant-id"]?.toString().trim();
  const headerSlug = req.headers["x-tenant-slug"]?.toString().trim().toLowerCase();

  let tenant = null;

  if (req.user.role === "SUPER_ADMIN") {
    if (!headerId && !headerSlug) {
      throw new AppError(
        400,
        "TENANT_CONTEXT_REQUIRED",
        "Super Admin must provide x-tenant-id or x-tenant-slug header to inspect a tenant workspace."
      );
    }
    tenant = await prisma.tenant.findFirst({
      where: headerId ? { id: headerId } : { slug: headerSlug },
      include: {
        plan: {
          include: { features: { include: { feature: true } } },
        },
      },
    });
  } else {
    if (!req.user.tenantId) {
      throw new AppError(403, "NO_TENANT_BOUND", "User account is not bound to any tenant.");
    }
    tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      include: {
        plan: {
          include: { features: { include: { feature: true } } },
        },
      },
    });

    if (!tenant) {
      throw new AppError(404, "TENANT_NOT_FOUND", "Bound tenant does not exist.");
    }

    if ((headerId && headerId !== tenant.id) || (headerSlug && headerSlug !== tenant.slug)) {
      throw new AppError(
        403,
        "CROSS_TENANT_FORBIDDEN",
        "Cross-tenant access denied. Requested tenant header does not match authenticated tenant."
      );
    }
  }

  if (!tenant) {
    throw new AppError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }

  if (tenant.status !== "active") {
    throw new AppError(403, "TENANT_SUSPENDED", "Tenant workspace is currently suspended.");
  }

  const enabledFeatures = new Set(
    tenant.plan.features.filter((pf) => pf.enabled).map((pf) => pf.feature.key)
  );

  req.tenant = tenant;
  req.tenantId = tenant.id;
  req.enabledFeatures = enabledFeatures;
  next();
});

export function requireFeature(featureKey) {
  return (req, _res, next) => {
    if (!req.enabledFeatures?.has(featureKey)) {
      return next(
        new AppError(
          403,
          "FEATURE_DISABLED",
          `Feature '${featureKey}' is disabled for plan '${req.tenant?.plan?.name || "unknown"}'.`,
          { feature: featureKey, plan: req.tenant?.plan?.code }
        )
      );
    }
    return next();
  };
}
