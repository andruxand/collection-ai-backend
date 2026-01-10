# DynamoDB Single-Table Data Model (MVP)

Table: `${service}-${stage}-core`

## Primary key pattern
- `pk = TENANT#<tenantId>`
- `sk = <ENTITY>#<...>`

## Entities
### Debtor Snapshot
- `pk = TENANT#t1`
- `sk = DEBTOR#PHONE#+573001112233`
- Fields (example):
  - `totalDueCop`, `daysPastDue`, `dueDate`, `stage`
  - `consents.whatsapp`, `consents.telegram`

### Lookups
To keep stable IDs across messages:
- `sk = LOOKUP#PHONE#+57...` → `{ debtorId }`
- `sk = LOOKUP#TG#<telegramUserId>` → `{ debtorId }`

### Conversation State (per channel)
- `sk = CONV#<channel>#<debtorId>`
- Fields:
  - `state`, `slots`, `attemptCount`, `lastIntent`, timestamps

### Contact State (cross-channel)
- `sk = CONTACT#<debtorId>`
- Fields:
  - `optedOut`
  - `lastDirectContactAt`, `lastDirectContactChannel`
  - `lastOutboundAt`
  - `nextContactAllowedAt`

### Reminder
- `sk = REMINDER#<dueAt>#<debtorId>`
- GSI for due scanning:
  - `gsi1pk = REMINDER_DUE#<yyyy-mm-dd>`
  - `gsi1sk = <dueAt>#<debtorId>`

### Audit
- `sk = AUDIT#<ISO>#<direction>#<messageId>`
- Stores policy, nlu, nba, text (optionally redacted)

See audit details: `docs/08-audit-logging.md`.


### Tenant Registry
- `pk = TENANTS`
- `sk = TENANT#<tenantId>`
- Purpose: allow scheduled jobs (e.g., outbound campaigns) to iterate active tenants without scanning the whole table.


## Country policy (jurisdiction baseline)

- `COUNTRY#<CC>` / `POLICY` stores the country baseline policy (e.g. `COUNTRY#CO`).
- `COUNTRIES` / `COUNTRY#<CC>` registry item for listing countries.
