import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/db.js";
import { createApp } from "../src/app.js";
import { seedDatabase, DEMO_ACCOUNTS } from "../prisma/seed.js";

let server;
let baseUrl;

async function req(path, { method = "GET", token, headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function login(account) {
  const r = await req("/api/auth/login", { method: "POST", body: account });
  assert.equal(r.status, 200);
  return r.data;
}

before(async () => {
  process.env.NODE_ENV = "test";
  await seedDatabase(prisma);
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

describe("RelayOps Multi-Tenant Isolation, RBAC & Live Feature Gating", () => {
  it("isolates incident records strictly per tenant and rejects header spoofing", async () => {
    const northstar = await login(DEMO_ACCOUNTS.northstarAdmin);
    const helios = await login(DEMO_ACCOUNTS.heliosAdmin);

    const nsList = await req("/api/tenant/incidents", { token: northstar.token });
    const hlList = await req("/api/tenant/incidents", { token: helios.token });

    assert.equal(nsList.status, 200);
    assert.equal(hlList.status, 200);
    assert.ok(nsList.data.incidents.every((i) => i.tenantId === northstar.tenant.id && i.key.startsWith("NSP-")));
    assert.ok(hlList.data.incidents.every((i) => i.tenantId === helios.tenant.id && i.key.startsWith("HLC-")));

    // Attempt to spoof Helios slug with Northstar JWT
    const spoofed = await req("/api/tenant/incidents", {
      token: northstar.token,
      headers: { "x-tenant-slug": "helios" },
    });
    assert.equal(spoofed.status, 403);
    assert.equal(spoofed.data.error.code, "CROSS_TENANT_FORBIDDEN");

    // Attempt to read or comment on Helios incident using Northstar JWT -> 404 (no leak)
    const heliosIncidentId = hlList.data.incidents[0].id;
    const crossRead = await req(`/api/tenant/incidents/${heliosIncidentId}`, {
      token: northstar.token,
    });
    assert.equal(crossRead.status, 404);

    const crossComment = await req(`/api/tenant/incidents/${heliosIncidentId}/comments`, {
      method: "POST",
      token: northstar.token,
      body: { body: "Cross-tenant injection attempt" },
    });
    assert.equal(crossComment.status, 404);
  });

  it("enforces RBAC between Super Admin, Tenant Admin, and On-Call Responder", async () => {
    const nsUser = await login(DEMO_ACCOUNTS.northstarUser);
    const nsAdmin = await login(DEMO_ACCOUNTS.northstarAdmin);

    // Tenant Admin cannot access Super Admin control plane
    const adminAttempt = await req("/api/admin/plans", { token: nsAdmin.token });
    assert.equal(adminAttempt.status, 403);
    assert.equal(adminAttempt.data.error.code, "FORBIDDEN_ROLE");

    // Responder can open and comment on an incident, but cannot delete it
    const created = await req("/api/tenant/incidents", {
      method: "POST",
      token: nsUser.token,
      body: {
        title: "Redis cache eviction spike on checkout session store",
        service: "session-cache",
        severity: "P3",
      },
    });
    assert.equal(created.status, 201);
    assert.match(created.data.incident.key, /^NSP-\d+$/);

    const commentRes = await req(`/api/tenant/incidents/${created.data.incident.id}/comments`, {
      method: "POST",
      token: nsUser.token,
      body: { body: "Scaled maxmemory from 4GB to 8GB." },
    });
    assert.equal(commentRes.status, 201);

    const userDel = await req(`/api/tenant/incidents/${created.data.incident.id}`, {
      method: "DELETE",
      token: nsUser.token,
    });
    assert.equal(userDel.status, 403);

    const adminDel = await req(`/api/tenant/incidents/${created.data.incident.id}`, {
      method: "DELETE",
      token: nsAdmin.token,
    });
    assert.equal(adminDel.status, 204);
  });

  it("enforces dynamic subscription plan feature gates immediately on toggle", async () => {
    const superAdmin = await login(DEMO_ACCOUNTS.superAdmin);
    const northstar = await login(DEMO_ACCOUNTS.northstarAdmin);
    const starterPlanId = northstar.tenant.plan.id;

    // Starter plan has sla_analytics gated off by default
    const blocked = await req("/api/tenant/analytics", { token: northstar.token });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error.code, "FEATURE_DISABLED");

    // Super Admin toggles sla_analytics ON for Starter
    const toggleOn = await req(`/api/admin/plans/${starterPlanId}/features/sla_analytics`, {
      method: "PATCH",
      token: superAdmin.token,
      body: { enabled: true },
    });
    assert.equal(toggleOn.status, 200);

    // Same existing Northstar JWT immediately unlocks SLA telemetry
    const unlocked = await req("/api/tenant/analytics", { token: northstar.token });
    assert.equal(unlocked.status, 200);
    assert.equal(unlocked.data.tenant.slug, "northstar");
    assert.equal(typeof unlocked.data.summary.mttrMinutes, "number");

    // Restore Starter sla_analytics back to false
    await req(`/api/admin/plans/${starterPlanId}/features/sla_analytics`, {
      method: "PATCH",
      token: superAdmin.token,
      body: { enabled: false },
    });

    const blockedAgain = await req("/api/tenant/analytics", { token: northstar.token });
    assert.equal(blockedAgain.status, 403);
  });

  it("delivers HMAC-SHA256 signed webhook pings for entitled tenants", async () => {
    const helios = await login(DEMO_ACCOUNTS.heliosAdmin);
    const list = await req("/api/tenant/webhooks", { token: helios.token });
    assert.equal(list.status, 200);
    assert.ok(list.data.webhooks.length >= 1);

    const ping = await req(`/api/tenant/webhooks/${list.data.webhooks[0].id}/ping`, {
      method: "POST",
      token: helios.token,
    });
    assert.equal(ping.status, 200);
    assert.match(ping.data.headers["X-RelayOps-Signature"], /^sha256=[a-f0-9]{64}$/);
  });
});
