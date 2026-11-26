# Multi-Tenant SaaS Core Backend

Node.js + Express.js REST API implementing strict multi-tenant data isolation, JWT authentication with RBAC, and dynamic subscription-plan feature gating.

## Architecture Overview

### 1. Multi-Tenant Isolation
- Every tenant-owned record (`Project`, `Webhook`, `User`, `AuditLog`) carries a foreign key `tenantId` with composite indexes (`(tenantId, createdAt)`, `(tenantId, status)`, `(tenantId, role)`).
- `src/middleware/tenant.js` (`requireTenant`) resolves the tenant strictly from the signed JWT `tenantId` claim for `TENANT_ADMIN` and `TENANT_USER` accounts.
- If a client also sends `x-tenant-id` or `x-tenant-slug` headers, the middleware verifies that it matches the authenticated tenant and rejects mismatches immediately with `403 CROSS_TENANT_FORBIDDEN`.
- All single-record updates and deletes filter by `{ id, tenantId: req.tenantId }`, returning `404` for foreign IDs without leaking existence.

### 2. Dynamic Subscription Plans & Feature Gating
- Plans (`Starter`, `Pro`, `Enterprise`) map to feature keys (`projects`, `analytics`, `webhooks`, `audit_logs`, `team_invites`) via the `PlanFeature` join table.
- `requireTenant` loads live `PlanFeature` flags from the database on each request (rather than relying on stale JWT claims).
- When a `SUPER_ADMIN` toggles a feature via `PATCH /api/admin/plans/:planId/features/:featureKey`, subsequent tenant API calls are immediately allowed or rejected (`403 FEATURE_DISABLED`).

### 3. Role-Based Access Control (RBAC)
- `SUPER_ADMIN`: manages plans, feature toggles, tenant provisioning, plan switching, and tenant suspension (`/api/admin/*`).
- `TENANT_ADMIN`: full access within their bound tenant, including deleting projects, registering webhooks, and inviting users.
- `TENANT_USER`: standard workspace operations within their bound tenant (cannot delete projects or manage webhooks/users).

## Database Schema

Normalized relational schema in `prisma/schema.prisma`:
- `Plan` 1:N `PlanFeature` N:1 `Feature`
- `Plan` 1:N `Tenant`
- `Tenant` 1:N `User`, `Project`, `Webhook`, `AuditLog`

## Local Setup

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

- API Base URL: `http://localhost:4000`
- Interactive Swagger Docs: `http://localhost:4000/api-docs`
- OpenAPI JSON: `http://localhost:4000/openapi.json`

## Automated Tests

```bash
npm test
```

Verifies cross-tenant isolation, header spoofing rejection (`403`), RBAC boundaries, and live feature-gate toggling.

## Seeded Test Credentials

| Role | Organization | Plan | Email | Password |
| :--- | :--- | :--- | :--- | :--- |
| `SUPER_ADMIN` | Platform | All | `superadmin@softlligence.dev` | `Admin123!` |
| `TENANT_ADMIN` | Acme Corp (`acme`) | Starter | `admin@acme.dev` | `Tenant123!` |
| `TENANT_USER` | Acme Corp (`acme`) | Starter | `user@acme.dev` | `Tenant123!` |
| `TENANT_ADMIN` | Globex Labs (`globex`) | Pro | `admin@globex.dev` | `Tenant123!` |
| `TENANT_USER` | Globex Labs (`globex`) | Pro | `user@globex.dev` | `Tenant123!` |

## Deployment (Render)

1. Push this repository to GitHub.
2. Create a new Web Service on Render (or import `render.yaml`).
3. Build command: `npm install && npx prisma generate && npx prisma db push`
4. Start command: `npm start`
5. Set `JWT_SECRET` and `CORS_ORIGIN` (your Vercel frontend URL). The database auto-seeds on first boot if empty.
