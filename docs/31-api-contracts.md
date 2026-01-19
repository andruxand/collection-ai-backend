# API Contracts (Frontend reference)

This doc lists endpoints, headers, and minimal request/response examples.

## Platform endpoints (JWT)
All require:
- `Authorization: Bearer <IdToken>`

### Tenant
- `GET /platform/tenant?tenantId=<id>`
  - 200: `{ ok: true, tenant: { tenantId, name, policy, channels?, clientAuth? } }`

- `POST /platform/tenant`
  - body: `{ tenantId, name, policy, channels? }`
  - 200: `{ ok: true, tenantId }`

### Handoffs
- `GET /platform/handoffs?tenantId=<id>`
  - 200: `{ ok: true, items: [...] }`

- `GET /platform/handoffs/detail?tenantId=<id>&caseSk=<HANDOFF#...>&eventsLimit=100`
  - 200: `{ ok: true, case: {...}, events: [...] }`

- `POST /platform/handoffs/assign`
  - body: `{ tenantId, caseSk, assignedToEmail?, assignedToUserSub?, priority?, tags? }`
  - 200: `{ ok: true }`

- `POST /platform/handoffs/close`
  - body: `{ tenantId, caseSk, reason }`
  - 200: `{ ok: true }`

### Operators / Users
- `GET /platform/operators?tenantId=<id>`
  - 200: `{ ok: true, items: [{ sub, email, role, enabled, status, tenantIds }] }`

- `POST /platform/users/invite`
  - body: `{ tenantId, email, role, tenantIds?, groupsAdd? }`
  - 200: `{ ok: true }`

- `POST /platform/users/status`
  - body: `{ tenantId, email, enabled?, role?, tenantIds? }`
  - 200: `{ ok: true }`

### Client API keys (issued by platform)
- `GET /platform/api-keys?tenantId=<id>`
  - 200: `{ ok: true, items: [{ keyId, label, status, createdAtIso, lastUsedAtIso? }] }`

- `POST /platform/api-keys/issue`
  - body: `{ tenantId, label? }`
  - 200: `{ ok: true, apiKey, keyId }`  (**apiKey shown once**)

- `POST /platform/api-keys/disable`
  - body: `{ tenantId, keyId }`
  - 200: `{ ok: true }`

### Audit
- `GET /platform/audit?tenantId=<id>&limit=50`
  - 200: `{ ok: true, items: [...] }`

## Client integration endpoint (API key)
Used by **servers only** (not browsers).

Headers required:
- `X-Tenant-Id: <tenantId>`
- `X-Api-Key: ck_<keyId>_<secret>`

- `POST /client/debtors/upsert`
  - body:
    ```json
    {
      "debtors": [
        {
          "debtorId": "PHONE#+573001112233",
          "phoneE164": "+573001112233",
          "telegramUserId": "12345",
          "totalDueCop": 980000,
          "daysPastDue": 37,
          "dueDate": "2025-12-15",
          "stage": "MID",
          "consents": { "whatsapp": true, "telegram": false }
        }
      ]
    }
    ```
  - 200: `{ ok: true, count }`

- `GET /client/conversations/status?channel=<whatsapp|telegram>&debtorId=<id>`
  - Alternative identifiers (instead of debtorId): `phoneE164=+57...` or `telegramUserId=...`
  - 200 response (shape):
    ```json
    {
      "ok": true,
      "tenantId": "tenant-demo",
      "channel": "whatsapp",
      "debtorId": "PHONE#+573001112233",
      "nowIso": "2026-01-18T19:22:01.123Z",
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
        "tenantId": "tenant-demo",
        "debtorId": "PHONE#+573001112233",
        "optedOut": false,
        "lastDirectContactAt": "2026-01-18T19:21:59.000Z",
        "lastDirectContactChannel": "whatsapp",
        "lastOutboundAt": "2026-01-18T19:22:00.000Z",
        "nextContactAllowedAt": "2026-01-20T19:20:00.000Z"
      }
    }
    ```
  - 404: `{ message: "Debtor not found for tenant", found: false }`

- `POST /client/debtors/close`
  - Closes a debtor case so the system will stop proactive outreach.
  - Inbound messages will receive a polite "case closed" response (no debt details).
  - body:
    ```json
    {
      "debtorId": "PHONE#+573001112233",
      "reason": "Pago acordado, cierre solicitado"
    }
    ```
  - 200: `{ ok: true }`

- `POST /client/debtors/telegram-enrollment-code`
  - Issues a one-time enrollment/linking code (default TTL: 24h) to bind a Telegram user to a debtor.
  - Expected debtor action in Telegram: `VINCULAR <CÓDIGO>`.
  - body:
    ```json
    {
      "debtorId": "PHONE#+573001112233"
    }
    ```
  - 200:
    ```json
    {
      "ok": true,
      "code": "A1B2C3D4",
      "expiresAtIso": "2026-01-19T19:22:01.123Z"
    }
    ```

## Error shape (frontend normalization)
- 400: `{ message: "Invalid body|Invalid query", errors?: {...} }`
- 401: `{ message: "Unauthorized" }`
- 403: `{ message: "Forbidden" }`
- 404: `{ message: "Not found" }`
- 500: `{ message: "Internal error" }`

## Rate limiting / abuse notes
- Webhooks enqueue inbound messages quickly, but processing happens in the orchestrator.
- The orchestrator applies per-debtor inbound flood controls (tenant-configurable) to avoid LLM costs.
- If a debtor exceeds the allowed inbound rate, processing is skipped for a short block window.

## Frontend note (BFF)
- Browsers should call a BFF instead of calling `/client/*` directly.
- A recommended BFF contract is documented in `docs/35-bff-contract.md`.
