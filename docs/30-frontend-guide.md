# Frontend Guide (Admin Console + Client Portal) — AI-Agent Ready

This is the **single source of truth** for building the web apps using IDE agents (Cursor/Claude/ChatGPT).
It defines **screens, routes, components, data contracts, auth, and UX flows**.

## Apps and personas

### Recommended: two SPAs (clean separation)
1) **Platform Admin Console** (for your company)
   - Personas: `SUPER_ADMIN`, `TENANT_ADMIN`, `OPERATOR`
   - Auth: **Cognito JWT** (HTTP API JWT authorizer)  
   - API: `/platform/*` endpoints

2) **Client Portal** (for your customer/creditor)
   - Personas: `CLIENT_ADMIN`, `CLIENT_VIEWER`
   - Auth: **Cognito JWT** (separate App Client recommended)
   - API: (future) `/client/*` JWT endpoints  
   - **Important:** the browser must NOT use long-lived API keys.

### Short-term MVP path for Client Portal (until JWT client endpoints exist)
Use a **BFF (Backend-for-Frontend)**:
- Client Portal → BFF (JWT)
- BFF → calls server-to-server endpoints using **API keys** (safe, because key never reaches browser)

## Tech stack (recommended)
- React + TypeScript
- Router: React Router
- Data: TanStack Query (React Query)
- UI: MUI (fastest for admin tables), or shadcn/ui if you prefer
- Forms: React Hook Form + Zod
- Auth:
  - Platform: Cognito Hosted UI or custom login (password auth for MVP)
  - Client Portal: Hosted UI strongly recommended

## Security must-haves
- Store tokens in memory (preferred) or secure storage; avoid localStorage for long-lived tokens.
- Use refresh tokens carefully (httpOnly cookies if you use a BFF).
- Always send: `Authorization: Bearer <id_token>` for `/platform/*`.
- Never display or persist API key secrets in the browser.
- Add audit visibility: `/platform/audit`.
- Use strict CORS, rate limiting, and input validation (already present in backend for most endpoints).

---

# Platform Admin Console

## Route map
Base prefix: `/admin`

### Auth
- `/admin/login`
- `/admin/logout`

### Tenant context
- `/admin/tenants` (tenant switcher)
- `/admin/tenants/:tenantId/overview` (quick stats placeholder)
- `/admin/tenants/:tenantId/settings` (tenant config/policy editor)

### Operations
- `/admin/tenants/:tenantId/handoffs` (handoff inbox)
- `/admin/tenants/:tenantId/handoffs/:caseSk` (handoff detail)

### Admin
- `/admin/tenants/:tenantId/users` (operators/admins)
- `/admin/tenants/:tenantId/api-keys` (client API keys management)
- `/admin/tenants/:tenantId/audit` (audit log)

## Global layout components
- `AppShell` (top bar + left nav)
- `TenantContextBar` (tenant chip + environment)
- `RoleGuard` (hides routes/actions by role/group)
- `ErrorBoundary` (route-level fallback)
- `ApiErrorToast` (central error UX)

## Data model in frontend
- `AuthContext`:
  - `idToken`, `userEmail`, `groups[]`, `role`, `tenantIds[]`
- `SelectedTenantContext`:
  - `tenantId` + derived policy timezone, etc.

## API client
Create a single typed client:
- `platformApi` → baseURL of your HTTP API
- attach token in interceptor
- standard error normalization

See API endpoints in `docs/31-api-contracts.md`.

## Screens (detailed)

### 1) Login
**Goal:** obtain JWT.
- Hosted UI (recommended): redirect-based login
- Custom login (MVP): username/password → Cognito `USER_PASSWORD_AUTH`

**UI components**
- Email field
- Password field
- Submit button
- Error display (invalid creds, disabled user)
- (Optional) "Forgot password"

### 2) Tenant Switcher
**Goal:** choose tenant from JWT claim `custom:tenantIds` (CSV) or allow any if group has `SUPER_ADMIN`.

**UI components**
- Tenant dropdown
- “Open tenant” button
- When user is not `SUPER_ADMIN`, only allow listed tenantIds.

### 3) Tenant Settings
Route: `/admin/tenants/:tenantId/settings`

**Data**
- `GET /platform/tenant?tenantId=...`
- `POST /platform/tenant` (save)

**Recommended UX**
- Tabs:
  1) Contact policy (hours, limits, cooldowns)
  2) Offer ladder (discounts/installments)
  3) Notifications (email config)
  4) Handoff policy
  5) Raw JSON editor (advanced)

**Components**
- `PolicyFormContactHours`
- `PolicyFormLimits`
- `PolicyFormOfferLadder`
- `PolicyFormNotificationsEmail`
- `PolicyFormHandoff`
- `JsonPolicyEditor` (monaco editor + Zod validation)
- `SaveBar` (dirty state, save/cancel)

### 4) Handoff Inbox
Route: `/admin/tenants/:tenantId/handoffs`

**Data**
- `GET /platform/handoffs?tenantId=...`

**UI**
- Table with columns:
  - createdAt, stage, intent, priority, tags, assignedToEmail, status
- Filters:
  - priority, stage, assigned/unassigned, intent
- Actions:
  - open detail
  - quick assign (modal)
  - quick close (modal)

### 5) Handoff Detail
Route: `/admin/tenants/:tenantId/handoffs/:caseSk`

**Data**
- `GET /platform/handoffs/detail?tenantId=...&caseSk=...`
- `POST /platform/handoffs/assign`
- `POST /platform/handoffs/close`

**UI sections**
- Case summary card
- Debt snapshot (amount, days late, attempts)
- Conversation preview (if stored)
- Events timeline (CREATED/ASSIGNED/CLOSED/EMAIL_SENT)
- Assign panel:
  - pick operator from `/platform/operators`
  - assign by email and optionally store `assignedToUserSub`
- Close panel:
  - reason, notes

### 6) Users (Operators/Admins)
Route: `/admin/tenants/:tenantId/users`

**Data**
- `GET /platform/operators?tenantId=...` (lists users with access)
- `POST /platform/users/invite`
- `POST /platform/users/status`

**UI**
- List users with role, enabled, status, tenantIds
- Invite modal:
  - email
  - role
  - (SUPER_ADMIN only) multi-tenant grant
- Disable/enable actions
- Copy `sub` and email

### 7) API Keys (Client Integrations)
Route: `/admin/tenants/:tenantId/api-keys`

**Data**
- `GET /platform/api-keys?tenantId=...`
- `POST /platform/api-keys/issue`
- `POST /platform/api-keys/disable`

**Critical UX**
- When issuing, show the secret **only once**:
  - modal with copy button
  - checkbox “I stored it securely”
- Provide a “Client onboarding snippet” block:
  - example curl with `X-Tenant-Id` and `X-Api-Key`

### 8) Audit Log
Route: `/admin/tenants/:tenantId/audit`

**Data**
- `GET /platform/audit?tenantId=...&limit=...`

**UI**
- Table with: atIso, actorEmail, action, resource
- Expand row to show payload JSON

---

# Client Portal (Blueprint)

## Route map
Base prefix: `/client`

- `/client/login`
- `/client/dashboard`
- `/client/debtors/upload`
- `/client/integrations` (webhooks/api keys rotation instructions)
- `/client/reports` (future)
- `/client/settings` (future)

## Upload debtors (MVP via BFF)
**UI**
- CSV upload
- mapping step (columns → required fields)
- validation step
- submit

**Backend**
- Client Portal calls BFF endpoint
- BFF uses API key server-side to call:
  - `POST /client/debtors/upsert` (machine-to-machine)

---

# Environment config for frontend
- `VITE_API_BASE_URL` (platform API base)
- `VITE_COGNITO_REGION`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_APP_CLIENT_ID_PLATFORM`
- `VITE_COGNITO_DOMAIN` (Hosted UI)
- (Later) `VITE_COGNITO_APP_CLIENT_ID_CLIENT_PORTAL`

---

# Non-negotiable conventions for IDE agents
- Never store API key secret in browser.
- Never call client endpoints from browser using API key.
- Use `tenantId` from route params, and validate against JWT claims.
- Use Zod schemas for all API responses and forms.
- Centralize error normalization and toasts.

See `docs/31-api-contracts.md` for endpoint details.
