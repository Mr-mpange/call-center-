# Platform Super Admin: Architecture Audit and Implementation Plan

Audit date: 2026-11-03

## Audit findings

### Application architecture

- This workspace is a React 19 / TypeScript frontend using TanStack Start and TanStack Router, Vite, and Tailwind. The server entrypoint delegates requests to the TanStack Start server entry.
- There is no separate backend application in this repository. `src/server.ts` handles request dispatch and error rendering; `src/start.ts` adds error and CSRF middleware for server functions. No platform API modules or server functions currently provide platform data or mutations.
- There are no database client dependencies, schema definitions, migrations, or database configuration in the repository.
- The former static record modules were removed during backend integration. Visible operational records now require authenticated API responses; empty or unavailable states are shown when a source is not connected.

### Authentication, roles, and authorization

- `src/routes/login.tsx` accepts any email-shaped value and password of at least eight characters, then navigates to `/admin` after a timer. Google sign-in also reports that it is not connected.
- No identity provider, password verification, server session, Super Admin account model, permission middleware, or route/API access-control policy was found.
- Role and permission matrices in the UI describe organization roles only. They are not enforced by a trusted backend.
- Therefore, `/superadmin` and its section routes are currently presentation routes, not protected platform administration endpoints.

### Existing UI and features

- The app has reusable layouts in `src/components/AppShell.tsx`, tables in `src/components/DataTable.tsx`, KPI/panel/status components in `src/components/kit.tsx`, and charts using Recharts.
- Business admin routes exist under `/admin/*`; operator/customer-facing pages use root routes such as `/`, `/live-calls`, `/history`, and `/contacts`.
- A visual IVR builder exists in `src/components/ivr/FlowBuilder.tsx` and `src/lib/ivr.ts`. Its flows are stored in browser local storage; simulation is local and explicitly not connected to live telephony.
- The softphone is client-side UI state. No call-control API, telephony event stream, recording service, or provider adapter was found.
- Africa's Talking references appear in demo copy and sample integration records only. No credentials, provider SDK, connection test, or real provider health check exists in this repository.
- The current Super Admin dashboard and section pages do not fabricate records or metrics. They must remain unavailable or empty until their authorized data sources are connected.

### Data isolation and deployment

- No tenant database, tenant-scoped query layer, server-side tenant authorization, or cross-tenant access policy was found.
- Existing route visibility is not security enforcement. There is no basis to safely expose business details, users, financial records, recordings, credentials, or logs to a platform administrator.
- No deployment database, auth, email, payment, telephony, AI, or monitoring configuration was found in the tracked project files.

## Short implementation plan

1. **Backend and identity foundation:** select/configure the production database and identity/session provider; define tenant, user, platform role, permission, and session models; add migrations and server-side authentication/authorization middleware.
2. **Core platform APIs:** add validated, paginated, audited APIs for dashboard aggregates, businesses, users/RBAC, and sessions. Enforce tenant boundaries and platform permissions at every endpoint.
3. **Platform shell and routes:** migrate the platform console to `/platform/*`, build permission-aware grouped navigation, responsive sidebar/topbar, breadcrumbs, search, notifications, and profile/session actions. Hide inaccessible destinations only after permissions come from the authenticated server session.
4. **Operational and commercial modules:** implement telephony/provider and number inventory, IVR platform controls, plans/subscriptions, finance, monitoring, integrations, security, support, and settings using verified persisted data and configured services.
5. **Hardening:** add database transaction and audit coverage, secret encryption/redaction, tenant-isolation and authorization tests, provider contract tests, loading/error/empty states, and deployment/migration documentation.

## External dependencies and decisions required

Production implementation cannot be completed safely from the current frontend-only source. It requires a production database and deployment connection details, an identity/session provider and initial Super Admin provisioning method, and service credentials/configuration for any provider integrations being enabled. Finance and monitoring modules also require their authoritative payment and telemetry sources. No credentials or live data source should be placed in frontend code.

Until those foundations are selected and configured, platform metrics and records remain non-authoritative. UI-only route protection, local storage, or fabricated records would not satisfy the security and production requirements in the implementation brief.

## Frontend-only local workspace implementation

The follow-up request specified continuing without a backend. The platform console therefore now has a local-only mode; this does not change the backend and does not make the original multi-tenant SaaS acceptance criteria production-ready.

- Platform navigation is available under `/platform/*`; former `/superadmin/*` URLs redirect into it.
- Platform sections support create, edit, delete, validation, search, and browser-local persistence. New installs start with no seeded platform records.
- Dashboard totals and charts derive only from records entered in the current browser. Empty sections show empty states; call, provider, finance, and availability data are not presented as live service signals.
- A local activity list records browser CRUD actions, but it is editable browser data and is not an immutable/security audit log.
- The navigation collapse preference and entered records persist in local storage. Nothing syncs to another browser or user.
- Login no longer reports success for arbitrary credentials. Sign-in and Google sign-in report that authentication is unavailable.
- Browser storage is not encrypted, shared, access-controlled, transaction-safe, or suitable for secrets or sensitive customer/payment records. Do not deploy the local workspace as a multi-tenant production admin system.

### Verification

- Production build: passed.
- Tests: 20 passed across 4 files, including local CRUD persistence and all platform route matches.
- Targeted ESLint on changed platform, shell, store, and test files with the repository-wide Prettier rule disabled: passed.
- Full `npm run lint` remains failing repository-wide because the existing codebase has 1,834 Prettier violations (plus 15 warnings); formatting the entire repository was not part of this change.
