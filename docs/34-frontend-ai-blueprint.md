# Frontend Blueprint (AI-ready)

This document is written so an AI agent (e.g. Copilot) can generate a working frontend with minimal guesswork.

Scope:
- Platform Admin UI (human operators) using **JWT-protected** `/platform/*` endpoints.
- Tenant self-service settings (within platform) including **policy limits**.
- Observability pages: audit list + handoff cases.

Non-scope:
- Client integration endpoints (`/client/*`) are **server-to-server** and must not be called directly from browsers.

## Concepts (UI glossary)

**Tenant**
- A collections company using the system.
- Has `tenantId`, `name`, `policy`, and optional channel configs.

**Debtor**
- A person/contact that the tenant wants to collect from.
- Stored in Dynamo and addressed by a stable `debtorId` (often derived from `PHONE#<e164>` or `TG#<userId>`).

**Conversation**
- Per tenant + channel + debtor.
- State machine is stored as `ConversationState` with `state`, `attemptCount`, `slots`.

**ContactState**
- Per tenant + debtor.
- Stores opt-out, outbound counters, cooldowns, and inbound flood-control state.

## Auth model (frontend)

The platform UI must authenticate via Cognito and call `/platform/*` endpoints.

Required headers:
- `Authorization: Bearer <IdToken>`

Note:
- The platform JWT contains tenant access claims; backend enforces tenant access.

## Screens to build

### 1) Tenant picker (if multi-tenant user)
Inputs:
- List of `tenantIds` from JWT claims.

Behavior:
- Store selected tenantId in local state.
- Append `tenantId=<selected>` to platform requests.

### 2) Tenant Settings
Endpoint:
- `GET /platform/tenant?tenantId=<id>`
- `POST /platform/tenant`

UI sections:
- Basic: name, tenantId (read-only)
- Channels:
  - WhatsApp: phoneNumberId, accessTokenSecretId
  - Telegram: botTokenSecretId
- Policy editor (JSON or form): focus on the knobs below.

#### Policy knobs (must be editable)

**Offer retry / agreement retries**
- `policy.offerPolicy.maxAttempts`
  - Semantics: maximum times the system will show offers / negotiate before entering a cooldown.
  - Used by NBA to return `COOLDOWN` when exceeded.

**Cooldown windows**
- `policy.cooldowns.rejectedOfferDays`
- `policy.cooldowns.noResponseDays`
- `policy.cooldowns.brokenPromiseDays`

**Inbound cost/abuse limits (new)**
- `policy.conversationPolicy.limits.maxInboundPerMinute` (default `6`)
- `policy.conversationPolicy.limits.blockForSecondsOnInboundFlood` (default `300`)
- `policy.conversationPolicy.limits.maxInboundTextChars` (default `800`)

Frontend behavior:
- Display helper text: “If a debtor floods inbound messages, we temporarily stop processing to prevent infra/LLM costs.”
- Validation:
  - `maxInboundPerMinute`: integer, 1..60
  - `blockForSecondsOnInboundFlood`: integer, 30..3600
  - `maxInboundTextChars`: integer, 50..5000

### 3) API Keys (client integration)
Endpoints:
- `GET /platform/api-keys?tenantId=<id>`
- `POST /platform/api-keys/issue`
- `POST /platform/api-keys/disable`

UI requirements:
- Table with keyId, label, status, createdAtIso, lastUsedAtIso
- Issue flow:
  - Show the returned `apiKey` exactly once with a “copy” button.
  - Warn user to store it securely; it cannot be retrieved again.

### 4) Handoffs
Endpoints:
- `GET /platform/handoffs?tenantId=<id>`
- `GET /platform/handoffs/detail?tenantId=<id>&caseSk=<...>`
- `POST /platform/handoffs/assign`
- `POST /platform/handoffs/close`

UI requirements:
- List view: status, createdAt, debtorId, channel, intent, assignedTo, tags
- Detail view: case + events timeline

### 5) Audit
Endpoint:
- `GET /platform/audit?tenantId=<id>&limit=50`

UI requirements:
- Table: atIso, direction, channel, debtorId, messageId
- Detail drawer: show text only if present.

## Debtor/Conversation “Status” UI

Today, the backend exposes a server-to-server client endpoint:
- `GET /client/conversations/status?...`

Important:
- Do **not** call `/client/*` directly from the browser.

Recommended architecture for UI:
1) Add a small BFF (frontend backend) in the frontend workspace.
2) BFF stores the client API key securely (server-side) and proxies requests.
3) The frontend calls the BFF to fetch debtor status.

Concrete contract to implement:
- See `docs/35-bff-contract.md`

Suggested UI widget (Debtor detail page):
- Conversation state: `conversation.state`
- Attempt count: `conversation.attemptCount`
- Can contact now: `canContactNow`
- Opt-out: `contact.optedOut`
- Cooldown until: `contact.nextContactAllowedAt || conversation.nextContactAllowedAt`

## Failure and edge cases (must be handled)

**Inbound flood control**
- If a debtor spams messages, the orchestrator will skip processing for a block window.
- UI expectation (if surfaced via audit logs): you may see inbound events without outbound replies during blocks.

**Opt-out**
- When `optedOut=true`, system should not send outbound messages.

**Cooldown**
- When cooldown is active, system may respond with a policy message or defer outbound.

## Implementation hints for Copilot

- Prefer generating a typed API client based on the contracts in `docs/31-api-contracts.md`.
- Keep policy editing as JSON first (fast), then progressively enhance to forms.
- For `TenantPolicy`, treat unknown fields as forward-compatible (do not drop them when saving).