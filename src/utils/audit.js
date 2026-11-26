import { prisma } from "../db.js";

export async function recordAudit({ tenantId = null, actorId, action, resource, meta = {} }) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId,
        action,
        resource,
        meta: JSON.stringify(meta),
      },
    });
  } catch (err) {
    console.error("[AuditLogError]", err.message);
  }
}
