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

describe("Multi-Tenant Isolation, RBAC & Dynamic Feature Gating", () => {
  it("enforces strict tenant data isolation and blocks cross-tenant headers", async () => {
    const acme = await login(DEMO_ACCOUNTS.acmeAdmin);
    const globex = await login(DEMO_ACCOUNTS.globexAdmin);

    const acmeList = await req("/api/tenant/projects", { token: acme.token });
    const globexList = await req("/api/tenant/projects", { token: globex.token });

    assert.equal(acmeList.status, 200);
    assert.equal(globexList.status, 200);
    assert.ok(acmeList.data.projects.every((p) => p.tenantId === acme.tenant.id));
    assert.ok(globexList.data.projects.every((p) => p.tenantId === globex.tenant.id));

    // Attempt to spoof Globex tenant via header using Acme token
    const spoofed = await req("/api/tenant/projects", {
      token: acme.token,
      headers: { "x-tenant-slug": "globex" },
    });
    assert.equal(spoofed.status, 403);
    assert.equal(spoofed.data.error.code, "CROSS_TENANT_FORBIDDEN");

    // Attempt to mutate Globex's project ID using Acme token
    const globexProjectId = globexList.data.projects[0].id;
    const crossUpdate = await req(`/api/tenant/projects/${globexProjectId}`, {
      method: "PATCH",
      token: acme.token,
      body: { name: "Hijacked" },
    });
    assert.equal(crossUpdate.status, 404);
  });

  it("enforces RBAC between Super Admin, Tenant Admin, and Tenant User", async () => {
    const acmeUser = await login(DEMO_ACCOUNTS.acmeUser);
    const acmeAdmin = await login(DEMO_ACCOUNTS.acmeAdmin);

    // Tenant Admin cannot hit Super Admin routes
    const adminRoute = await req("/api/admin/plans", { token: acmeAdmin.token });
    assert.equal(adminRoute.status, 403);
    assert.equal(adminRoute.data.error.code, "FORBIDDEN_ROLE");

    // Tenant User can create a project but cannot delete it
    const created = await req("/api/tenant/projects", {
      method: "POST",
      token: acmeUser.token,
      body: { name: "RBAC Temp Project", description: "Testing delete permissions" },
    });
    assert.equal(created.status, 201);

    const userDel = await req(`/api/tenant/projects/${created.data.project.id}`, {
      method: "DELETE",
      token: acmeUser.token,
    });
    assert.equal(userDel.status, 403);

    const adminDel = await req(`/api/tenant/projects/${created.data.project.id}`, {
      method: "DELETE",
      token: acmeAdmin.token,
    });
    assert.equal(adminDel.status, 204);
  });

  it("dynamically gates backend APIs when Super Admin toggles plan features", async () => {
    const superAdmin = await login(DEMO_ACCOUNTS.superAdmin);
    const acme = await login(DEMO_ACCOUNTS.acmeAdmin);
    const starterPlanId = acme.tenant.plan.id;

    // Starter plan has analytics disabled initially
    const blocked = await req("/api/tenant/analytics", { token: acme.token });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error.code, "FEATURE_DISABLED");

    // Super Admin enables analytics on Starter plan
    const enableRes = await req(`/api/admin/plans/${starterPlanId}/features/analytics`, {
      method: "PATCH",
      token: superAdmin.token,
      body: { enabled: true },
    });
    assert.equal(enableRes.status, 200);
    assert.equal(enableRes.data.enabled, true);

    // Same existing Acme JWT immediately gains access (live DB check)
    const allowed = await req("/api/tenant/analytics", { token: acme.token });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data.tenant.slug, "acme");

    // Restore Starter plan analytics back to false
    await req(`/api/admin/plans/${starterPlanId}/features/analytics`, {
      method: "PATCH",
      token: superAdmin.token,
      body: { enabled: false },
    });

    const blockedAgain = await req("/api/tenant/analytics", { token: acme.token });
    assert.equal(blockedAgain.status, 403);
  });
});
