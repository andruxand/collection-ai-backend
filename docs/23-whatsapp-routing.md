# WhatsApp multi-tenant routing (phone_number_id -> tenantId)

## Why this exists
In WhatsApp Cloud API, inbound webhooks include the *business phone* identifier (`metadata.phone_number_id`).
In a multi-tenant platform, different tenants can connect different WhatsApp numbers. We must route each
inbound message to the correct `tenantId` before enqueuing it for orchestration.

## Data model (DynamoDB)
Single-table item:

- `pk = WA_PHONE#<phoneNumberId>`
- `sk = TENANT`
- attributes:
  - `tenantId: string`

Example:
```json
{
  "pk": "WA_PHONE#1234567890",
  "sk": "TENANT",
  "tenantId": "tenant-demo"
}
```

## Runtime flow
1. `whatsappWebhook` extracts `metadata.phone_number_id`.
2. It calls `resolveTenantFromWhatsApp(phoneNumberId)`.
3. The tenant id is set into the normalized inbound event and then sent to SQS.

## Seeding mappings (MVP)
Mappings are seeded from JSON files under:
- `configs/whatsapp-mappings/*.json`

Run:
```bash
TABLE_NAME=... AWS_REGION=... npm run seed:whatsapp-mappings
```

## Notes
- If no mapping exists, the system falls back to `TENANT_DEFAULT_ID` (or `tenant-demo`) for development.
- For production, always seed the mapping for each connected WhatsApp number to avoid misrouting.
