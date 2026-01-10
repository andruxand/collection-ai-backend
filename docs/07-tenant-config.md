# Tenant Configuration (MVP, no frontend)

Tenants are stored in DynamoDB as:
- `pk = TENANT#<tenantId>`
- `sk = META`

You can create/update them via:
1) **Admin API**: `POST /admin/tenant` (preferred in MVP)
2) **Seed script**: `node scripts/seedTenant.js configs/tenant-demo.json`

## Admin API: upsert tenant
Endpoint:
- `POST /admin/tenant`
Headers:
- `X-Api-Key: <adminApiKey>`
Body:
```json
{
  "tenantId": "tenant-demo",
  "name": "Demo Tenant",
  "channels": {
    "whatsapp": { "phoneNumberId": "...", "accessTokenSecretId": "..." },
    "telegram": { "botTokenSecretId": "..." }
  },
  "policy": {
    "contactPolicy": { "...": "..." },
    "contactLimitsByStage": {
      "EARLY": { "maxOutboundPerDay": 1, "maxOutboundPerWeek": 1 },
      "MID":   { "maxOutboundPerDay": 1, "maxOutboundPerWeek": 3 },
      "LATE":  { "maxOutboundPerDay": 1, "maxOutboundPerWeek": 4 }
    },
    "auditPolicy": { "retentionDays": 90, "storeMessageText": true, "storeDecisionPayloads": true },
    "exportPolicy": { "enabled": false },
    "handoffPolicy": { "enabled": true, "stageMin": "MID", "intents": ["DISPUTE","ANGRY"] },
    "cooldowns": { "rejectedOfferDays": 3, "noResponseDays": 2, "brokenPromiseDays": 1 },
    "offerPolicy": { "ladder": [{"attempt":1,"maxDiscountPct":0}], "maxAttempts": 6, "hardCapDiscountPct": 15 },
    "tonePolicy": { "T1": "amable", "T2": "directo", "T3": "formal" }
  }
}
```

## Export audit (optional)
Endpoint:
- `POST /admin/export/audit`
Body:
```json
{ "tenantId": "tenant-demo", "date": "2026-01-02" }
```
Requires `policy.exportPolicy.enabled=true` and `policy.exportPolicy.s3Bucket`.

## Seed Script
```bash
export TABLE_NAME=collections-ai-mvp-dev-core
export AWS_REGION=us-east-1
node scripts/seedTenant.js configs/tenant-demo.json
```


## Handoff ops
- List: `GET /admin/handoffs?tenantId=<id>`
- Close: `POST /admin/handoffs/close`


## Notifications
Configure email notifications:
```json
"notificationPolicy": {
  "email": {
    "enabled": true,
    "fromAddress": "verified-ses-sender@example.com",
    "toAddresses": ["ops@example.com"],
    "subjectPrefix": "[CollectionsAI]",
    "includeInboundText": true
  }
}
```


## Seeding client API keys (no UI)
Use:
```
API_KEY_PEPPER=... TABLE_NAME=... AWS_REGION=... node scripts/seedTenant.js configs/tenant-demo.json --issue-client-key --label "Prod integration"
```


## Inviting platform users (no UI)
```
PLATFORM_USER_POOL_ID=... TABLE_NAME=... AWS_REGION=... node scripts/seedTenant.js configs/tenant-demo.json --invite-user ops1@company.com --role OPERATOR --tenant-ids tenant-demo
```
