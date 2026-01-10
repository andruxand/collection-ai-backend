# Handoff (Human-in-the-loop)

## What is a handoff?
A **handoff** is the transition from the automated assistant to a human agent when:
- The user disputes the debt (`DISPUTE`)
- The user is angry/escalating (`ANGRY`)
- Any other tenant-configured trigger

The goal is risk reduction and higher resolution rates for complex cases.

## Why persist to DynamoDB?
For an MVP you want to:
- View a list of open cases (even without a UI)
- Track status (OPEN/CLOSED), timestamps, outcomes
- Avoid losing cases if a downstream worker fails
- Enable future dashboards and reporting with minimal refactors

We still *optionally* emit an event to SQS to notify/route the case to:
- a human queue (CRM, email, Slack, etc.)
- a backoffice workflow

## Data model
- `pk = TENANT#<tenantId>`
- `sk = HANDOFF#<ISO>#<caseId>`
- `gsi1pk = HANDOFF#OPEN#<tenantId>` (or CLOSED)
- `gsi1sk = <ISO>#<caseId>`

## Tenant config
See `docs/07-tenant-config.md`:
```json
"handoffPolicy": {
  "enabled": true,
  "stageMin": "MID",
  "intents": ["DISPUTE","ANGRY"],
  "retentionDays": 30,
  "storeInboundText": true
}
```

## Admin endpoints (MVP ops)
- `GET /admin/handoffs?tenantId=tenant-demo&limit=50`
- `POST /admin/handoffs/close` with:
```json
{ "tenantId": "tenant-demo", "caseSk": "HANDOFF#...", "reason": "Resolved by agent" }
```


## Assignment
Cases can be assigned to an operator (email) and enriched with priority/tags via `/platform/handoffs/assign`.

## Email notifications
When a case is created (and optionally when assigned), the system can send an email via AWS SES, configurable per tenant.
See `docs/07-tenant-config.md` (notificationPolicy.email).


## Case detail
Use `GET /platform/handoffs/detail` to retrieve the case + events for a detail view.
