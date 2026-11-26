import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

export const DEMO_ACCOUNTS = {
  superAdmin: { email: "superadmin@softlligence.dev", password: "Admin123!" },
  acmeAdmin: { email: "admin@acme.dev", password: "Tenant123!" },
  acmeUser: { email: "user@acme.dev", password: "Tenant123!" },
  globexAdmin: { email: "admin@globex.dev", password: "Tenant123!" },
  globexUser: { email: "user@globex.dev", password: "Tenant123!" },
};

const FEATURES = [
  { key: "projects", name: "Projects Workspace", description: "Create and manage tenant-scoped projects" },
  { key: "analytics", name: "Usage Analytics", description: "Aggregated metrics and activity trends for the tenant" },
  { key: "webhooks", name: "Outbound Webhooks", description: "Register event webhooks for external integrations" },
  { key: "audit_logs", name: "Audit Trail", description: "Inspect security and mutation logs inside the tenant" },
  { key: "team_invites", name: "Team Management", description: "Add and manage users within the tenant organization" },
];

const PLANS = [
  {
    code: "starter",
    name: "Starter",
    description: "Core workspace for small teams.",
    priceMonthly: 29,
    enabledKeys: ["projects"],
  },
  {
    code: "pro",
    name: "Pro",
    description: "Full operational suite with analytics, webhooks, and audit logs.",
    priceMonthly: 99,
    enabledKeys: ["projects", "analytics", "webhooks", "audit_logs", "team_invites"],
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description: "Unrestricted multi-team capabilities and compliance controls.",
    priceMonthly: 249,
    enabledKeys: ["projects", "analytics", "webhooks", "audit_logs", "team_invites"],
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

  const acme = await prisma.tenant.upsert({
    where: { slug: "acme" },
    update: {},
    create: { slug: "acme", name: "Acme Corp", planId: planByCode.starter.id, status: "active" },
  });

  const globex = await prisma.tenant.upsert({
    where: { slug: "globex" },
    update: {},
    create: { slug: "globex", name: "Globex Labs", planId: planByCode.pro.id, status: "active" },
  });

  const adminHash = await bcrypt.hash("Admin123!", 10);
  const tenantHash = await bcrypt.hash("Tenant123!", 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.superAdmin.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.superAdmin.email,
      passwordHash: adminHash,
      name: "Platform Super Admin",
      role: "SUPER_ADMIN",
      tenantId: null,
    },
  });

  const acmeAdmin = await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.acmeAdmin.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.acmeAdmin.email,
      passwordHash: tenantHash,
      name: "Rina Pratama",
      role: "TENANT_ADMIN",
      tenantId: acme.id,
    },
  });

  await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.acmeUser.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.acmeUser.email,
      passwordHash: tenantHash,
      name: "Budi Santoso",
      role: "TENANT_USER",
      tenantId: acme.id,
    },
  });

  const globexAdmin = await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.globexAdmin.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.globexAdmin.email,
      passwordHash: tenantHash,
      name: "Elena Vance",
      role: "TENANT_ADMIN",
      tenantId: globex.id,
    },
  });

  await prisma.user.upsert({
    where: { email: DEMO_ACCOUNTS.globexUser.email },
    update: {},
    create: {
      email: DEMO_ACCOUNTS.globexUser.email,
      passwordHash: tenantHash,
      name: "Marcus Chen",
      role: "TENANT_USER",
      tenantId: globex.id,
    },
  });

  if ((await prisma.project.count({ where: { tenantId: acme.id } })) === 0) {
    await prisma.project.createMany({
      data: [
        {
          tenantId: acme.id,
          name: "Acme Billing Migration",
          description: "Move legacy invoice exports to scheduled background workers.",
          status: "active",
          createdById: acmeAdmin.id,
        },
        {
          tenantId: acme.id,
          name: "Customer Onboarding Form",
          description: "Reduce signup friction from 5 steps down to 2.",
          status: "active",
          createdById: acmeAdmin.id,
        },
      ],
    });
  }

  if ((await prisma.project.count({ where: { tenantId: globex.id } })) === 0) {
    await prisma.project.createMany({
      data: [
        {
          tenantId: globex.id,
          name: "Globex Telemetry Pipeline",
          description: "Ingest real-time sensor payloads with tenant-partitioned storage.",
          status: "active",
          createdById: globexAdmin.id,
        },
        {
          tenantId: globex.id,
          name: "Zero-Downtime Schema Rollout",
          description: "Expand-and-contract migration playbook for core tables.",
          status: "archived",
          createdById: globexAdmin.id,
        },
      ],
    });
  }

  if ((await prisma.webhook.count({ where: { tenantId: globex.id } })) === 0) {
    await prisma.webhook.create({
      data: {
        tenantId: globex.id,
        url: "https://hooks.globex.example/v1/events",
        event: "project.created",
        active: true,
      },
    });
  }

  if ((await prisma.auditLog.count()) === 0) {
    await prisma.auditLog.createMany({
      data: [
        {
          tenantId: null,
          actorId: superAdmin.id,
          action: "platform.seeded",
          resource: "system",
          meta: JSON.stringify({ plans: 3, tenants: 2 }),
        },
        {
          tenantId: globex.id,
          actorId: globexAdmin.id,
          action: "webhook.created",
          resource: "webhook",
          meta: JSON.stringify({ event: "project.created" }),
        },
      ],
    });
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("/prisma/seed.js");
if (isDirectRun) {
  const prisma = new PrismaClient();
  seedDatabase(prisma)
    .then(() => console.log("Seed completed successfully."))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
