# RelayOps — Multi-Tenant SaaS Backend

Node.js + Express.js + Prisma REST API for **RelayOps**, a multi-tenant incident management and SLA telemetry platform. Built with strict query-level tenant isolation, RBAC, atomic per-tenant incident keys, HMAC-SHA256 webhooks, and live subscription-plan feature gating.

## Core Architecture

1. **Strict Multi-Tenant Isolation (`src/middleware/tenant.js`)**
   - Every tenant-scoped table (`Incident`, `IncidentComment`, `WebhookEndpoint`, `User`, `AuditLog`) is indexed by `tenantId`.
   - For `TENANT_ADMIN` and `TENANT_USER`, the signed JWT `tenantId` is authoritative. Any mismatched `x-tenant-id` or `x-tenant-slug` header is rejected immediately with `403 CROSS_TENANT_FORBIDDEN`.
   - Single-record reads, comments, updates, and deletes filter by `{ id, tenantId: req.tenantId }`, returning `404` for foreign IDs without leaking existence.
2. **Dynamic Subscription Plans & Live Feature Gating**
   - Plans (`Starter`, `Growth`, `Enterprise`) grant capabilities (`incidents`, `sla_analytics`, `webhooks`, `team_invites`, `audit_logs`) via `PlanFeature`.
   - Entitlements are queried live from the database on each request so `SUPER_ADMIN` toggles take effect immediately (`403 FEATURE_DISABLED`) without waiting for JWT expiry.
3. **Role-Based Access Control (`src/middleware/auth.js`)**
   - `SUPER_ADMIN`: manages plans, feature entitlements, tenant provisioning, plan switching, and workspace suspension (`/api/admin/*`).
   - `TENANT_ADMIN`: full organization control including incident deletion, HMAC webhook management, and member invitations.
   - `TENANT_USER`: creates, triages, and comments on incidents within their bound organization.

## Local Setup

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

- API Base: `http://localhost:4000`
- Swagger UI: `http://localhost:4000/api-docs`
- OpenAPI JSON: `http://localhost:4000/openapi.json`

## Automated Integration Tests

```bash
npm test
```

## Seeded Test Credentials

| Role | Organization | Plan | Email | Password |
| :--- | :--- | :--- | :--- | :--- |
| `SUPER_ADMIN` | RelayOps Control Plane | Platform | `ops@relayops.io` | `Admin123!` |
| `TENANT_ADMIN` | NorthstarPay (`northstar`) | Starter ($0) | `arin@northstarpay.co` | `Tenant123!` |
| `TENANT_USER` | NorthstarPay (`northstar`) | Starter ($0) | `dina@northstarpay.co` | `Tenant123!` |
| `TENANT_ADMIN` | Helios Cloud (`helios`) | Growth ($79) | `devon@helioscloud.io` | `Tenant123!` |
| `TENANT_USER` | Helios Cloud (`helios`) | Growth ($79) | `sara@helioscloud.io` | `Tenant123!` |
