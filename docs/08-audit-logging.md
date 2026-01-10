# Audit Logging

## Why
Collections operations often need:
- Proof of what was communicated
- The decision path (policy + offers)
- A way to investigate disputes

## What we store (MVP)
For each inbound/outbound interaction:
- timestamp
- channel + direction
- message ids
- debtor id (stable) and **hashed phone** if present
- policy result + reason
- nlu result (intent/entities)
- nba decision + offers shown
- final message text (optional redaction)

## Where
- DynamoDB item:
  - `pk = TENANT#<tenantId>`
  - `sk = AUDIT#<ISO>#<direction>#<messageId>`

## Production recommendations
- Encrypt sensitive fields, or store only hashes
- Add retention policies (TTL per tenant)
- Export to S3 for long-term retention if required
