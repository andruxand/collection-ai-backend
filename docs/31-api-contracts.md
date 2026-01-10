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
  - body: `{ items: [...] }`

## Error shape (frontend normalization)
- 400: `{ message: "Invalid body|Invalid query", errors?: {...} }`
- 401: `{ message: "Unauthorized" }`
- 403: `{ message: "Forbidden" }`
- 404: `{ message: "Not found" }`
- 500: `{ message: "Internal error" }`
