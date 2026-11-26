export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Multi-Tenant SaaS Core API",
    version: "1.0.0",
    description:
      "Production-oriented Express.js REST API demonstrating strict tenant data isolation, JWT + RBAC, and dynamic subscription plan feature gating.",
  },
  servers: [{ url: "/", description: "Current server" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        security: [],
        responses: { 200: { description: "Service and database healthy" } },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Authenticate as Super Admin, Tenant Admin, or Tenant User",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", example: "admin@acme.dev" },
                  password: { type: "string", example: "Tenant123!" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "JWT token, user profile, tenant, and live enabledFeatures" },
          401: { description: "Invalid credentials" },
        },
      },
    },
    "/api/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Return current authenticated user and live tenant feature flags",
        responses: { 200: { description: "User and tenant payload" } },
      },
    },
    "/api/admin/plans": {
      get: {
        tags: ["Super Admin"],
        summary: "List all subscription plans and feature toggle matrix",
        responses: { 200: { description: "Plans and features list" }, 403: { description: "Super Admin only" } },
      },
    },
    "/api/admin/plans/{planId}/features/{featureKey}": {
      patch: {
        tags: ["Super Admin"],
        summary: "Dynamically toggle a feature on/off for a subscription plan",
        parameters: [
          { name: "planId", in: "path", required: true, schema: { type: "string" } },
          { name: "featureKey", in: "path", required: true, schema: { type: "string", example: "analytics" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["enabled"],
                properties: { enabled: { type: "boolean" } },
              },
            },
          },
        },
        responses: { 200: { description: "Updated plan feature flag" } },
      },
    },
    "/api/admin/tenants": {
      get: {
        tags: ["Super Admin"],
        summary: "List all tenants with subscription plan and usage counts",
        responses: { 200: { description: "Tenants list" } },
      },
      post: {
        tags: ["Super Admin"],
        summary: "Provision a new tenant and initial Tenant Admin user",
        responses: { 201: { description: "Tenant and admin created" } },
      },
    },
    "/api/admin/tenants/{tenantId}/plan": {
      patch: {
        tags: ["Super Admin"],
        summary: "Change a tenant's subscription plan",
        parameters: [{ name: "tenantId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Tenant plan updated" } },
      },
    },
    "/api/tenant/projects": {
      get: {
        tags: ["Tenant Workspace"],
        summary: "List projects scoped strictly to the authenticated tenant (feature: projects)",
        responses: { 200: { description: "Tenant projects" }, 403: { description: "Feature disabled or cross-tenant denied" } },
      },
      post: {
        tags: ["Tenant Workspace"],
        summary: "Create a project inside the authenticated tenant (feature: projects)",
        responses: { 201: { description: "Project created" } },
      },
    },
    "/api/tenant/projects/{id}": {
      patch: {
        tags: ["Tenant Workspace"],
        summary: "Update a tenant-owned project",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Updated project" }, 404: { description: "Not found in tenant" } },
      },
      delete: {
        tags: ["Tenant Workspace"],
        summary: "Delete a tenant-owned project (TENANT_ADMIN only)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 204: { description: "Deleted" }, 403: { description: "TENANT_ADMIN required" } },
      },
    },
    "/api/tenant/analytics": {
      get: {
        tags: ["Tenant Workspace"],
        summary: "Get tenant-scoped usage metrics (feature: analytics)",
        responses: { 200: { description: "Analytics summary" }, 403: { description: "Feature disabled" } },
      },
    },
    "/api/tenant/webhooks": {
      get: {
        tags: ["Tenant Workspace"],
        summary: "List tenant webhooks (feature: webhooks)",
        responses: { 200: { description: "Webhooks list" } },
      },
      post: {
        tags: ["Tenant Workspace"],
        summary: "Create a tenant webhook (feature: webhooks, TENANT_ADMIN only)",
        responses: { 201: { description: "Webhook created" } },
      },
    },
    "/api/tenant/users": {
      get: {
        tags: ["Tenant Workspace"],
        summary: "List members of the authenticated tenant",
        responses: { 200: { description: "Tenant users" } },
      },
      post: {
        tags: ["Tenant Workspace"],
        summary: "Invite/create a member in the tenant (feature: team_invites, TENANT_ADMIN only)",
        responses: { 201: { description: "User created" } },
      },
    },
    "/api/tenant/audit-logs": {
      get: {
        tags: ["Tenant Workspace"],
        summary: "List tenant-scoped audit trail events (feature: audit_logs)",
        responses: { 200: { description: "Audit logs" } },
      },
    },
  },
};
