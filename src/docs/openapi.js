export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "RelayOps — Multi-Tenant Incident & SLA API",
    version: "2.0.0",
    description:
      "Multi-tenant SaaS REST API implementing query-level tenant isolation, RBAC, sequential per-tenant incident keys, HMAC webhooks, and live subscription plan feature gating.",
  },
  servers: [{ url: "/", description: "Current host" }],
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
        summary: "Service and database health probe",
        security: [],
        responses: { 200: { description: "Healthy" } },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Identity"],
        summary: "Sign in as Super Admin, Tenant Admin, or On-Call Responder",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", example: "arin@northstarpay.co" },
                  password: { type: "string", example: "Tenant123!" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Signed JWT, user profile, tenant, and live enabledFeatures" },
          401: { description: "Invalid credentials" },
        },
      },
    },
    "/api/auth/me": {
      get: {
        tags: ["Identity"],
        summary: "Fetch current session and live plan entitlements",
        responses: { 200: { description: "Session payload" } },
      },
    },
    "/api/admin/plans": {
      get: {
        tags: ["Platform Admin"],
        summary: "List subscription plans and feature entitlement matrix",
        responses: { 200: { description: "Plans and features" }, 403: { description: "SUPER_ADMIN required" } },
      },
    },
    "/api/admin/plans/{planId}/features/{featureKey}": {
      patch: {
        tags: ["Platform Admin"],
        summary: "Toggle a module entitlement on or off for a subscription plan",
        parameters: [
          { name: "planId", in: "path", required: true, schema: { type: "string" } },
          { name: "featureKey", in: "path", required: true, schema: { type: "string", example: "sla_analytics" } },
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
        responses: { 200: { description: "Updated entitlement" } },
      },
    },
    "/api/admin/tenants": {
      get: {
        tags: ["Platform Admin"],
        summary: "List tenant organizations with plan and usage counts",
        responses: { 200: { description: "Tenant directory" } },
      },
      post: {
        tags: ["Platform Admin"],
        summary: "Provision a new isolated tenant organization and initial Tenant Admin",
        responses: { 201: { description: "Provisioned" } },
      },
    },
    "/api/admin/tenants/{tenantId}/plan": {
      patch: {
        tags: ["Platform Admin"],
        summary: "Switch a tenant organization's subscription plan",
        parameters: [{ name: "tenantId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Plan updated" } },
      },
    },
    "/api/tenant/incidents": {
      get: {
        tags: ["Incidents"],
        summary: "List incidents scoped to the authenticated tenant (feature: incidents)",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "severity", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "Tenant incident list" }, 403: { description: "Cross-tenant or feature denied" } },
      },
      post: {
        tags: ["Incidents"],
        summary: "Open a new incident with atomic per-tenant sequence key",
        responses: { 201: { description: "Created incident" } },
      },
    },
    "/api/tenant/incidents/{id}": {
      get: {
        tags: ["Incidents"],
        summary: "Get incident details and investigation timeline comments",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Incident detail" }, 404: { description: "Not found in tenant" } },
      },
      patch: {
        tags: ["Incidents"],
        summary: "Update incident status, severity, assignee, or summary",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Updated incident" } },
      },
      delete: {
        tags: ["Incidents"],
        summary: "Delete an incident (TENANT_ADMIN only)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 204: { description: "Deleted" }, 403: { description: "TENANT_ADMIN required" } },
      },
    },
    "/api/tenant/incidents/{id}/comments": {
      post: {
        tags: ["Incidents"],
        summary: "Append an investigation note to the incident timeline",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 201: { description: "Comment added" } },
      },
    },
    "/api/tenant/analytics": {
      get: {
        tags: ["Analytics"],
        summary: "Compute live MTTR, SLA compliance %, and service breakdown (feature: sla_analytics)",
        responses: { 200: { description: "SLA telemetry" }, 403: { description: "FEATURE_DISABLED" } },
      },
    },
    "/api/tenant/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "List HMAC-signed webhook endpoints (feature: webhooks)",
        responses: { 200: { description: "Webhooks list" } },
      },
      post: {
        tags: ["Webhooks"],
        summary: "Register a webhook endpoint with generated whsec_ secret (TENANT_ADMIN only)",
        responses: { 201: { description: "Webhook created" } },
      },
    },
    "/api/tenant/webhooks/{id}/ping": {
      post: {
        tags: ["Webhooks"],
        summary: "Send a signed SHA-256 HMAC test ping to a webhook endpoint",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Ping delivered with signature headers" } },
      },
    },
    "/api/tenant/users": {
      get: {
        tags: ["Members"],
        summary: "List members belonging to the authenticated tenant",
        responses: { 200: { description: "Members list" } },
      },
      post: {
        tags: ["Members"],
        summary: "Provision a new member seat (feature: team_invites, TENANT_ADMIN only)",
        responses: { 201: { description: "Member created" } },
      },
    },
    "/api/tenant/audit-logs": {
      get: {
        tags: ["Compliance"],
        summary: "List immutable tenant audit events (feature: audit_logs)",
        responses: { 200: { description: "Audit log list" } },
      },
    },
  },
};
