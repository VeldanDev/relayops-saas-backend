import crypto from "node:crypto";
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

const SLA_BY_SEVERITY = { P1: 30, P2: 60, P3: 120, P4: 240 };

const createIncidentSchema = z.object({
  title: z.string().min(3).max(140),
  description: z.string().max(1500).optional().default(""),
  service: z.string().min(2).max(60).optional().default("core-api"),
  severity: z.enum(["P1", "P2", "P3", "P4"]).optional().default("P2"),
  assigneeId: z.string().nullable().optional(),
});

const updateIncidentSchema = z.object({
  title: z.string().min(3).max(140).optional(),
  description: z.string().max(1500).optional(),
  service: z.string().min(2).max(60).optional(),
  severity: z.enum(["P1", "P2", "P3", "P4"]).optional(),
  status: z.enum(["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED"]).optional(),
  assigneeId: z.string().nullable().optional(),
});

const createCommentSchema = z.object({
  body: z.string().min(2).max(1000),
});

const createWebhookSchema = z.object({
  description: z.string().max(120).optional().default(""),
  url: z.string().url(),
  events: z
    .array(z.enum(["incident.created", "incident.updated", "incident.resolved", "sla.breached"]))
    .min(1)
    .default(["incident.created", "incident.resolved"]),
});

const createUserSchema = z.object({
  name: z.string().min(2).max(80),
  title: z.string().min(2).max(80).optional().default("Site Reliability Engineer"),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["TENANT_ADMIN", "TENANT_USER"]).default("TENANT_USER"),
});

// --- Incidents (Feature: incidents) ---
router.get(
  "/incidents",
  requireFeature("incidents"),
  asyncHandler(async (req, res) => {
    const { status, severity, q } = req.query;
    const where = {
      tenantId: req.tenantId,
      ...(status && status !== "ALL" ? { status: String(status) } : {}),
      ...(severity && severity !== "ALL" ? { severity: String(severity) } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: String(q) } },
              { key: { contains: String(q) } },
              { service: { contains: String(q) } },
            ],
          }
        : {}),
    };

    const incidents = await prisma.incident.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        reporter: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true } },
      },
    });

    res.json({ tenantId: req.tenantId, incidents });
  })
);

router.get(
  "/incidents/:id",
  requireFeature("incidents"),
  asyncHandler(async (req, res) => {
    const incident = await prisma.incident.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: {
        reporter: { select: { id: true, name: true, email: true, title: true } },
        assignee: { select: { id: true, name: true, email: true, title: true } },
        comments: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true, email: true, role: true } } },
        },
      },
    });

    if (!incident) {
      throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found in this organization.");
    }

    res.json({ incident });
  })
);

router.post(
  "/incidents",
  requireFeature("incidents"),
  validate(createIncidentSchema),
  asyncHandler(async (req, res) => {
    if (req.body.assigneeId) {
      const member = await prisma.user.findFirst({
        where: { id: req.body.assigneeId, tenantId: req.tenantId },
      });
      if (!member) {
        throw new AppError(422, "INVALID_ASSIGNEE", "Assignee does not belong to this organization.");
      }
    }

    const incident = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: req.tenantId },
        data: { nextIncidentSeq: { increment: 1 } },
      });
      const seq = t.nextIncidentSeq - 1;
      const key = `${t.codePrefix}-${seq}`;

      return tx.incident.create({
        data: {
          tenantId: req.tenantId,
          key,
          title: req.body.title.trim(),
          description: req.body.description.trim(),
          service: req.body.service.trim().toLowerCase(),
          severity: req.body.severity,
          status: "OPEN",
          slaMinutes: SLA_BY_SEVERITY[req.body.severity] || 60,
          reporterId: req.user.id,
          assigneeId: req.body.assigneeId || req.user.id,
        },
        include: {
          reporter: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          _count: { select: { comments: true } },
        },
      });
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "incident.created",
      resource: `incident:${incident.key}`,
      meta: { severity: incident.severity, service: incident.service },
    });

    res.status(201).json({ incident });
  })
);

router.patch(
  "/incidents/:id",
  requireFeature("incidents"),
  validate(updateIncidentSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.incident.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) {
      throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found in this organization.");
    }

    if (req.body.assigneeId) {
      const member = await prisma.user.findFirst({
        where: { id: req.body.assigneeId, tenantId: req.tenantId },
      });
      if (!member) {
        throw new AppError(422, "INVALID_ASSIGNEE", "Assignee does not belong to this organization.");
      }
    }

    let resolvedAtUpdate = {};
    if (req.body.status === "RESOLVED" && existing.status !== "RESOLVED") {
      resolvedAtUpdate = { resolvedAt: new Date() };
    } else if (req.body.status && req.body.status !== "RESOLVED") {
      resolvedAtUpdate = { resolvedAt: null };
    }

    const incident = await prisma.incident.update({
      where: { id: existing.id },
      data: {
        ...(req.body.title !== undefined ? { title: req.body.title.trim() } : {}),
        ...(req.body.description !== undefined ? { description: req.body.description.trim() } : {}),
        ...(req.body.service !== undefined ? { service: req.body.service.trim().toLowerCase() } : {}),
        ...(req.body.severity !== undefined
          ? { severity: req.body.severity, slaMinutes: SLA_BY_SEVERITY[req.body.severity] || existing.slaMinutes }
          : {}),
        ...(req.body.status !== undefined ? { status: req.body.status } : {}),
        ...(req.body.assigneeId !== undefined ? { assigneeId: req.body.assigneeId } : {}),
        ...resolvedAtUpdate,
      },
      include: {
        reporter: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true } },
      },
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "incident.updated",
      resource: `incident:${existing.key}`,
      meta: req.body,
    });

    res.json({ incident });
  })
);

router.delete(
  "/incidents/:id",
  requireFeature("incidents"),
  requireRole("SUPER_ADMIN", "TENANT_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.incident.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) {
      throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found in this organization.");
    }

    await prisma.incident.delete({ where: { id: existing.id } });
    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "incident.deleted",
      resource: `incident:${existing.key}`,
      meta: { title: existing.title },
    });

    res.status(204).send();
  })
);

router.post(
  "/incidents/:id/comments",
  requireFeature("incidents"),
  validate(createCommentSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.incident.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) {
      throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found in this organization.");
    }

    const comment = await prisma.incidentComment.create({
      data: {
        tenantId: req.tenantId,
        incidentId: existing.id,
        authorId: req.user.id,
        body: req.body.body.trim(),
      },
      include: { author: { select: { id: true, name: true, email: true, role: true } } },
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "incident.commented",
      resource: `incident:${existing.key}`,
      meta: { preview: comment.body.slice(0, 60) },
    });

    res.status(201).json({ comment });
  })
);

// --- SLA & MTTR Analytics (Feature: sla_analytics) ---
router.get(
  "/analytics",
  requireFeature("sla_analytics"),
  asyncHandler(async (req, res) => {
    const incidents = await prisma.incident.findMany({
      where: { tenantId: req.tenantId },
      select: {
        severity: true,
        status: true,
        service: true,
        slaMinutes: true,
        createdAt: true,
        resolvedAt: true,
      },
    });

    const total = incidents.length;
    const active = incidents.filter((i) => i.status !== "RESOLVED").length;
    const resolved = incidents.filter((i) => i.status === "RESOLVED");

    let mttrMinutes = 0;
    let withinSla = 0;
    if (resolved.length > 0) {
      const durations = resolved.map((i) => {
        const end = i.resolvedAt ? new Date(i.resolvedAt).getTime() : Date.now();
        const dur = Math.max(1, Math.round((end - new Date(i.createdAt).getTime()) / 60_000));
        if (dur <= i.slaMinutes) withinSla += 1;
        return dur;
      });
      mttrMinutes = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    }
    const slaCompliancePct = resolved.length > 0 ? Math.round((withinSla / resolved.length) * 100) : 100;

    const bySeverity = ["P1", "P2", "P3", "P4"].map((sev) => ({
      severity: sev,
      count: incidents.filter((i) => i.severity === sev).length,
    }));

    const byStatus = ["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED"].map((st) => ({
      status: st,
      count: incidents.filter((i) => i.status === st).length,
    }));

    const serviceMap = {};
    for (const i of incidents) {
      serviceMap[i.service] = (serviceMap[i.service] || 0) + 1;
    }
    const byService = Object.entries(serviceMap)
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      tenant: { id: req.tenant.id, slug: req.tenant.slug, name: req.tenant.name },
      plan: req.tenant.plan.code,
      summary: {
        totalIncidents: total,
        activeIncidents: active,
        resolvedIncidents: resolved.length,
        mttrMinutes,
        slaCompliancePct,
      },
      bySeverity,
      byStatus,
      byService,
    });
  })
);

// --- Webhooks (Feature: webhooks) ---
router.get(
  "/webhooks",
  requireFeature("webhooks"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.webhookEndpoint.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      webhooks: rows.map((w) => ({
        ...w,
        events: JSON.parse(w.events || "[]"),
      })),
    });
  })
);

router.post(
  "/webhooks",
  requireFeature("webhooks"),
  requireRole("SUPER_ADMIN", "TENANT_ADMIN"),
  validate(createWebhookSchema),
  asyncHandler(async (req, res) => {
    const signingSecret = `whsec_${crypto.randomBytes(16).toString("hex")}`;
    const created = await prisma.webhookEndpoint.create({
      data: {
        tenantId: req.tenantId,
        description: req.body.description.trim(),
        url: req.body.url,
        events: JSON.stringify(req.body.events),
        signingSecret,
        active: true,
      },
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "webhook.created",
      resource: `webhook:${created.id}`,
      meta: { url: created.url, events: req.body.events },
    });

    res.status(201).json({
      webhook: { ...created, events: req.body.events },
    });
  })
);

router.post(
  "/webhooks/:id/ping",
  requireFeature("webhooks"),
  requireRole("SUPER_ADMIN", "TENANT_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) {
      throw new AppError(404, "WEBHOOK_NOT_FOUND", "Webhook endpoint not found in this organization.");
    }

    const payload = JSON.stringify({
      event: "webhook.ping",
      tenant: req.tenant.slug,
      timestamp: new Date().toISOString(),
    });
    const signature = crypto.createHmac("sha256", existing.signingSecret).update(payload).digest("hex");

    const updated = await prisma.webhookEndpoint.update({
      where: { id: existing.id },
      data: { lastStatus: 200, lastDeliveryAt: new Date() },
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "webhook.pinged",
      resource: `webhook:${existing.id}`,
      meta: { url: existing.url },
    });

    res.json({
      delivered: true,
      statusCode: 200,
      headers: {
        "X-RelayOps-Event": "webhook.ping",
        "X-RelayOps-Signature": `sha256=${signature}`,
      },
      webhook: { ...updated, events: JSON.parse(updated.events || "[]") },
    });
  })
);

router.delete(
  "/webhooks/:id",
  requireFeature("webhooks"),
  requireRole("SUPER_ADMIN", "TENANT_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) {
      throw new AppError(404, "WEBHOOK_NOT_FOUND", "Webhook endpoint not found in this organization.");
    }

    await prisma.webhookEndpoint.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

// --- Team Members (Feature: team_invites for POST) ---
router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, title: true, email: true, role: true, createdAt: true },
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
        title: req.body.title.trim(),
        email: req.body.email.trim().toLowerCase(),
        passwordHash,
        role: req.body.role,
      },
      select: { id: true, name: true, title: true, email: true, role: true, createdAt: true },
    });

    await recordAudit({
      tenantId: req.tenantId,
      actorId: req.user.id,
      action: "member.invited",
      resource: `user:${user.email}`,
      meta: { role: user.role, title: user.title },
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
      take: 40,
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
