# BFF Contract (Frontend Backend) — AI-ready

This document defines a recommended **Backend-for-Frontend (BFF)** contract so a browser-based UI can safely access debtor/conversation status without exposing client API keys.

Why a BFF:
- `/client/*` endpoints are **server-to-server** (API key) and must not be called from browsers.
- The BFF holds the tenant client API key securely (server env/secret) and proxies the necessary calls.

## Security model

Frontend (browser) → BFF:
- Use your platform auth (Cognito) or your own session.
- Never ship `ck_<keyId>_<secret>` to the browser.

BFF → Collections backend `/client/*`:
- Add headers:
  - `X-Tenant-Id: <tenantId>`
  - `X-Api-Key: <clientApiKey>`

Recommended BFF storage:
- Store API keys in server env vars or secrets (e.g., AWS Secrets Manager / Vercel env).

## Base URL configuration

- `COLLECTIONS_BACKEND_BASE_URL` (example: `https://<api-id>.execute-api.<region>.amazonaws.com`)
- `COLLECTIONS_CLIENT_API_KEY` (the `ck_...` key; secret)

If you support multiple tenants in a single BFF, store keys per tenant:
- `COLLECTIONS_CLIENT_API_KEY__TENANT_DEMO=ck_...`

## BFF endpoints (recommended)

### 1) Health
`GET /bff/health`

Response 200:
```json
{ "ok": true }
```

### 2) Debtor status (safe wrapper)

`GET /bff/debtors/status`

Query:
- `tenantId` (required)
- `channel` = `whatsapp|telegram` (required)
- One of:
  - `debtorId`
  - `phoneE164` (E.164, e.g. `+573001112233`)
  - `telegramUserId`

Behavior:
- Validates query shape.
- Calls collections backend `GET /client/conversations/status`.
- Returns a browser-safe payload.

Response 200:
```json
{
  "ok": true,
  "tenantId": "tenant-demo",
  "channel": "whatsapp",
  "debtorId": "PHONE#+573001112233",
  "canContactNow": true,
  "conversation": {
    "state": "OFFER_MENU",
    "attemptCount": 2,
    "lastIntent": "NEGOTIATE",
    "lastContactAt": "2026-01-18T19:20:00.000Z",
    "nextContactAllowedAt": "2026-01-20T19:20:00.000Z",
    "slots": {}
  },
  "contact": {
    "optedOut": false,
    "lastDirectContactAt": "2026-01-18T19:21:59.000Z",
    "lastDirectContactChannel": "whatsapp",
    "lastOutboundAt": "2026-01-18T19:22:00.000Z",
    "nextContactAllowedAt": "2026-01-20T19:20:00.000Z"
  }
}
```

Response 404:
```json
{ "ok": false, "message": "Not found" }
```

### 3) Debtor upsert (optional wrapper)

If you want the UI to upload debtors via browser, do it through the BFF.

`POST /bff/debtors/upsert`

Body:
```json
{
  "tenantId": "tenant-demo",
  "debtors": [
    {
      "phoneE164": "+573001112233",
      "totalDueCop": 980000,
      "daysPastDue": 37,
      "dueDate": "2025-12-15",
      "consents": { "whatsapp": true }
    }
  ]
}
```

Behavior:
- Validate body.
- Call collections backend `POST /client/debtors/upsert`.
- Return `{ ok: true, count }`.

## Browser-safe normalization rules

The backend may include additional fields. For stability:
- Pass through `conversation` and `contact` as-is, but never include secrets.
- Consider stripping high-cardinality maps if you expose them (e.g. inbound counters) unless needed.

## Caching / cost control guidance

To reduce backend calls from UI refresh:
- Cache `GET /bff/debtors/status` for 3–10 seconds per `(tenantId, channel, debtorId)`.

To protect BFF itself:
- Rate-limit per browser session/IP.
- Add input length caps.

## Implementation hints (Copilot)

If using Next.js:
- Implement Route Handlers under `app/api/bff/.../route.ts`.
- Read secrets from server-only env vars.
- Use `fetch()` with explicit timeouts and safe error mapping.

If using a Node/Express BFF:
- Use zod for input validation.
- Use an allowlist for query params and headers.
