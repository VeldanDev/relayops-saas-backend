import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

export const DEMO_ACCOUNTS = {
  superAdmin: { email: "ops@relayops.io", password: "Admin123!" },
  northstarAdmin: { email: "arin@northstarpay.co", password: "Tenant123!" },
  northstarUser: { email: "dina@northstarpay.co", password: "Tenant123!" },
  heliosAdmin: { email: "devon@helioscloud.io", password: "Tenant123!" },
  heliosUser: { email: "sara@helioscloud.io", password: "Tenant123!" },
};

const FEATURES = [
  {
    key: "incidents",
    name: "Incident Queue & Triage",
    description: "Create, assign, comment on, and resolve tenant-scoped incidents",
  },
  {
    key: "sla_analytics",
    name: "SLA & MTTR Telemetry",
    description: "Mean time to resolution, SLA breach tracking, and service breakdown",
  },
  {
    key: "webhooks",
    name: "HMAC Event Webhooks",
    description: "Signed outbound HTTP callbacks on incident lifecycle transitions",
  },
  {
    key: "team_invites",
    name: "Seat Provisioning",
    description: "Invite additional responders and admins into the organization",
  },
  {
    key: "audit_logs",
    name: "Compliance Audit Trail",
    description: "Immutable record of administrative and operational mutations",
  },
];

const PLANS = [
  {
    code: "starter",
    name: "Starter",
    description: "Essential incident queue for early engineering teams.",
    priceMonthly: 0,
    enabledKeys: ["incidents"],
  },
  {
    code: "growth",
    name: "Growth",
    description: "Full operational suite with SLA telemetry, webhooks, and team expansion.",
    priceMonthly: 79,
    enabledKeys: ["incidents", "sla_analytics", "webhooks", "team_invites", "audit_logs"],
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description: "Dedicated multi-region SLA guarantees and full compliance controls.",
    priceMonthly: 249,
    enabledKeys: ["incidents", "sla_analytics", "webhooks", "team_invites", "audit_logs"],
  },
];

export async function seedDatabase(prisma) {
  const featureByKey = {};
  for (const f of FEATURES) {
    featureByKey[f.key] = await prisma.feature.upsert({
      where: { key: f.key },
      update: { name: f.name, description: f.description },
      create: f,
    });
  }

  const planByCode = {};
  for (const p of PLANS) {
    const plan = await prisma.plan.upsert({
      where: { code: p.code },
      update: { name: p.name, description: p.description, priceMonthly: p.priceMonthly },
      create: { code: p.code, name: p.name, description: p.description, priceMonthly: p.priceMonthly },
    });
    planByCode[p.code] = plan;

    for (const f of FEATURES) {
      const enabled = p.enabledKeys.includes(f.key);
      await prisma.planFeature.upsert({
        where: { planId_featureId: { planId: plan.id, featureId: featureByKey[f.key].id } },
        update: {},
        create: { planId: plan.id, featureId: featureByKey[f.key].id, enabled },
      });
    }
  }

  const northstar = await prisma.tenant.upsert({
    where: { slug: "northstar" },
    update: {},
    create: {
      slug: "northstar",
      codePrefix: "NSP",
      nextIncidentSeq: 104,
      name: "NorthstarPay",
      planId: planByCode.starter.id,
      status: "active",
    },
  });

  const helios = await prisma.tenant.upsert({
    where: { slug: "helios" },
    update: {},
    create: {
      slug: "helios",
      codePrefix: "HLC",
      nextIncidentSeq: 105,
      name: "Helios Cloud",
      planId: planByCode.growth.id,
      status: "active",
    },
  });

  const adminHash = await bcrypt.hash("Admin123!", 10);
  const tenantHash = await bcrypt.hash("Tenant123!", 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.superAdmin.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.superAdmin.email,
      passwordHash: adminHash,
      name: "Maya Lin",
      title: "Platform Operations Lead",
      role: "SUPER_ADMIN",
      tenantId: null,
    },
  });

  const nsAdmin = await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.northstarAdmin.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.northstarAdmin.email,
      passwordHash: tenantHash,
      name: "Arin Wijaya",
      title: "Payments Engineering Lead",
      role: "TENANT_ADMIN",
      tenantId: northstar.id,
    },
  });

  const nsUser = await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.northstarUser.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.northstarUser.email,
      passwordHash: tenantHash,
      name: "Dina Kusuma",
      title: "On-Call SRE",
      role: "TENANT_USER",
      tenantId: northstar.id,
    },
  });

  const hlAdmin = await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.heliosAdmin.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.heliosAdmin.email,
      passwordHash: tenantHash,
      name: "Devon Brooks",
      title: "VP Infrastructure",
      role: "TENANT_ADMIN",
      tenantId: helios.id,
    },
  });

  const hlUser = await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.heliosUser.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.heliosUser.email,
      passwordHash: tenantHash,
      name: "Sara Lindqvist",
      title: "Staff Reliability Engineer",
      role: "TENANT_USER",
      tenantId: helios.id,
    },
  });

  const now = Date.now();
  const minsAgo = (m) => new Date(now - m * 60_000);

  if ((await prisma.incident.count({ where: { tenantId: northstar.id } })) === 0) {
    const nsp101 = await prisma.incident.create({
      data: {
        tenantId: northstar.id,
        key: "NSP-101",
        title: "Elevated p99 latency on QRIS settlement callback",
        description:
          "Upstream acquirer gateway timeouts are causing retry queue buildup on worker pool B. Checkout authorization remains unaffected.",
        service: "settlement-worker",
        severity: "P1",
        status: "INVESTIGATING",
        slaMinutes: 30,
        reporterId: nsAdmin.id,
        assigneeId: nsUser.id,
        createdAt: minsAgo(22),
      },
    });

    await prisma.incidentComment.createMany({
      data: [
        {
          tenantId: northstar.id,
          incidentId: nsp101.id,
          authorId: nsUser.id,
          body: "Confirmed connection pool saturation on settlement-db-replica-2. Draining stuck workers and raising circuit-breaker threshold.",
          createdAt: minsAgo(14),
        },
        {
          tenantId: northstar.id,
          incidentId: nsp101.id,
          authorId: nsAdmin.id,
          body: "Merchant status banner updated. Keep retry concurrency capped at 16 until p99 drops below 400ms.",
          createdAt: minsAgo(6),
        },
      ],
    });

    await prisma.incident.create({
      data: {
        tenantId: northstar.id,
        key: "NSP-102",
        title: "Delayed PDF invoice generation for batch payouts",
        description: "Font subsetting cache miss after container rollout v2.18.4.",
        service: "billing-documents",
        severity: "P2",
        status: "MITIGATED",
        slaMinutes: 60,
        reporterId: nsUser.id,
        assigneeId: nsAdmin.id,
        createdAt: minsAgo(95),
      },
    });

    await prisma.incident.create({
      data: {
        tenantId: northstar.id,
        key: "NSP-103",
        title: "Stale FX rate fallback triggered on SGD corridor",
        description: "Primary pricing feed rotated TLS certificate; pinned CA bundle updated.",
        service: "fx-quoter",
        severity: "P3",
        status: "RESOLVED",
        slaMinutes: 120,
        createdAt: minsAgo(260),
        resolvedAt: minsAgo(218),
        reporterId: nsAdmin.id,
        assigneeId: nsUser.id,
      },
    });
  }

  if ((await prisma.incident.count({ where: { tenantId: helios.id } })) === 0) {
    const hlc101 = await prisma.incident.create({
      data: {
        tenantId: helios.id,
        key: "HLC-101",
        title: "Packet loss between ap-southeast-1 ingress and mesh-gw-04",
        description:
          "BGP session flap observed on transit provider B. Automated traffic shift routed 85% of ingress to mesh-gw-02.",
        service: "edge-proxy-ap1",
        severity: "P1",
        status: "MITIGATED",
        slaMinutes: 30,
        reporterId: hlAdmin.id,
        assigneeId: hlUser.id,
        createdAt: minsAgo(38),
      },
    });

    await prisma.incidentComment.createMany({
      data: [
        {
          tenantId: helios.id,
          incidentId: hlc101.id,
          authorId: hlUser.id,
          body: "BGP peer drained cleanly. Packet loss back to 0.00% across synthetic probes in Singapore and Jakarta.",
          createdAt: minsAgo(24),
        },
      ],
    });

    await prisma.incident.create({
      data: {
        tenantId: helios.id,
        key: "HLC-102",
        title: "WAL archive lag exceeding 4GB on tenant-shard-07",
        description: "Object storage multipart upload throttling during peak hourly snapshot window.",
        service: "postgres-clusters",
        severity: "P2",
        status: "INVESTIGATING",
        slaMinutes: 60,
        reporterId: hlUser.id,
        assigneeId: hlAdmin.id,
        createdAt: minsAgo(51),
      },
    });

    await prisma.incident.create({
      data: {
        tenantId: helios.id,
        key: "HLC-103",
        title: "OIDC token refresh skew for federated SAML workspaces",
        description: "Added 30-second clock-skew tolerance on token verifier.",
        service: "identity-gateway",
        severity: "P2",
        status: "RESOLVED",
        slaMinutes: 60,
        createdAt: minsAgo(310),
        resolvedAt: minsAgo(276),
        reporterId: hlAdmin.id,
        assigneeId: hlUser.id,
      },
    });

    await prisma.incident.create({
      data: {
        tenantId: helios.id,
        key: "HLC-104",
        title: "Delayed Prometheus scrape target discovery in eu-central",
        description: "Controller informer cache resync interval tuned from 10m to 90s.",
        service: "metrics-ingestor",
        severity: "P4",
        status: "RESOLVED",
        slaMinutes: 240,
        createdAt: minsAgo(520),
        resolvedAt: minsAgo(465),
        reporterId: hlUser.id,
        assigneeId: hlUser.id,
      },
    });
  }

  if ((await prisma.webhookEndpoint.count({ where: { tenantId: helios.id } })) === 0) {
    await prisma.webhookEndpoint.create({
      data: {
        tenantId: helios.id,
        description: "PagerDuty & Slack #ops-critical bridge",
        url: "https://hooks.helioscloud.example/v1/relayops",
        events: JSON.stringify(["incident.created", "incident.resolved", "sla.breached"]),
        signingSecret: `whsec_${crypto.randomBytes(16).toString("hex")}`,
        active: true,
        lastStatus: 200,
        lastDeliveryAt: minsAgo(24),
      },
    });
  }

  if ((await prisma.auditLog.count()) === 0) {
    await prisma.auditLog.createMany({
      data: [
        {
          tenantId: null,
          actorId: superAdmin.id,
          action: "platform.initialized",
          resource: "system:plans",
          meta: JSON.stringify({ plans: ["starter", "growth", "enterprise"] }),
          createdAt: minsAgo(600),
        },
        {
          tenantId: helios.id,
          actorId: hlAdmin.id,
          action: "webhook.registered",
          resource: "webhook:ops-bridge",
          meta: JSON.stringify({ events: ["incident.created", "incident.resolved"] }),
          createdAt: minsAgo(180),
        },
        {
          tenantId: helios.id,
          actorId: hlUser.id,
          action: "incident.mitigated",
          resource: "incident:HLC-101",
          meta: JSON.stringify({ service: "edge-proxy-ap1", severity: "P1" }),
          createdAt: minsAgo(24),
        },
        {
          tenantId: northstar.id,
          actorId: nsAdmin.id,
          action: "incident.created",
          resource: "incident:NSP-101",
          meta: JSON.stringify({ service: "settlement-worker", severity: "P1" }),
          createdAt: minsAgo(22),
        },
      ],
    });
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("/prisma/seed.js");
if (isDirectRun) {
  const prisma = new PrismaClient();
  seedDatabase(prisma)
    .then(() => console.log("RelayOps database seeded."))
    .catch((err) => {
      console.error("Seed error:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
