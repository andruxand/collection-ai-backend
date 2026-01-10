# Runbook

## Deploy
```bash
npm i
npm run deploy:dev
```

## Required SSM params (per stage)
- `/${service}/${stage}/metaVerifyToken`
- `/${service}/${stage}/metaAppSecretArn`
- `/${service}/${stage}/adminApiKey`

## Required Secrets
- WhatsApp access token secret id/arn
- Telegram bot token secret id/arn
- (Optional) OpenAI key secret id/arn

## Configure OpenAI
Set envs (in `serverless.ts` or mapped from SSM):
- `LLM_PROVIDER_JSON='{"provider":"openai","model":"gpt-4o-mini"}'`
- `LLM_OPENAI_KEY_SECRET_ID='<secret arn/id>'`

## Test (manual)
1) Ingest a debtor via `/admin/debtors`
2) Send a WhatsApp message to your registered number (or Telegram message to your bot)
3) Check CloudWatch logs:
   - orchestrator logs
   - reminder tick logs
4) Inspect DynamoDB:
   - DEBTOR#, CONV#, CONTACT#, AUDIT#

## Troubleshooting
- Webhook not verifying:
  - check `META_VERIFY_TOKEN` matches Meta configuration
- WhatsApp signature failures:
  - ensure `META_APP_SECRET_ARN` points to correct app secret
- LLM errors:
  - missing `LLM_OPENAI_KEY_SECRET_ID`
  - secret access denied (IAM)


## Seed tenant
Option A (API): POST /admin/tenant
Option B (script): node scripts/seedTenant.js configs/tenant-demo.json




## Seed country policies
Baseline legal policies per country are stored in DynamoDB.

```
TABLE_NAME=... AWS_REGION=... npm run seed:country-policies
```

## Seed WhatsApp phone routing (multi-tenant)
To route inbound WhatsApp webhooks to the correct tenant in production, seed mappings:

```
TABLE_NAME=... AWS_REGION=... npm run seed:whatsapp-mappings
```

Mappings live under `configs/whatsapp-mappings/*.json` and must contain:
- `phoneNumberId` (WhatsApp Cloud API `metadata.phone_number_id`)
- `tenantId`

## Seeding client API keys (no UI)
Use:
```
API_KEY_PEPPER=... TABLE_NAME=... AWS_REGION=... node scripts/seedTenant.js configs/tenant-demo.json --issue-client-key --label "Prod integration"
```


## Inviting platform users (no UI)
```
PLATFORM_USER_POOL_ID=... TABLE_NAME=... AWS_REGION=... node scripts/seedTenant.js configs/tenant-demo.json --invite-user ops1@company.com --role OPERATOR --tenant-ids tenant-demo
```


## Seed country policies (required)

Country policies are stored in DynamoDB.

```bash
export TABLE_NAME="<CoreTable name>"
npm run seed:country-policies
```


### Seed Telegram bot mappings (multi-tenant routing)

```bash
TABLE_NAME=... npm run seed:telegram-bot-mappings
```
