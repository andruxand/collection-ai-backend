# Audit (Platform actions)

## Storage
Platform actions are stored in DynamoDB as:
- `pk = TENANT#<tenantId>`
- `sk = PLATFORM_AUDIT#<iso>#<ulid>`

## Endpoint
- `GET /platform/audit?tenantId=<id>&limit=50`

## What is audited
- tenant upserts
- handoff assign/close
- client API key issue/disable
- platform user invite/update

## Retention
Controlled by env:
- `PLATFORM_AUDIT_RETENTION_DAYS` (default: 180)

Set to 0 to keep indefinitely (not recommended).
