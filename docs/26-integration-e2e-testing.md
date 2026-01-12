# Integration E2E testing (WhatsApp + Telegram)

This runbook covers end-to-end testing for WhatsApp and Telegram channels.

## 1) AWS prerequisites

- DynamoDB table (CoreTable) desplegada para el `STAGE` que vas a usar.
- Inbound SQS queue existe y `INBOUND_QUEUE_URL` está configurado vía `serverless.ts`.
- API Gateway HTTP API deployed and publicly reachable.
- CloudWatch logs enabled (default).

## 2) Install and validate locally

```bash
npm ci
npm run typecheck
npm test
```

## 3) Deploy

```bash
sls deploy --stage dev
```

Note the API base URL for HTTP API.

For a **quick dev onboarding** you can use:

- Telegram: `npm run onboard:telegram-dev`
- WhatsApp: `npm run onboard:whatsapp-dev`

Those commands will seed country policies, channel mappings and the demo tenant for `STAGE=dev`.

## 4) Seed required data

### 4.1 Country policies (if applicable)
```bash
STAGE=dev AWS_REGION=us-east-1 npm run seed:country-policies
```

### 4.2 Tenant configs (if applicable)
Follow `docs/07-tenant-config.md` and `docs/20-demo-accounts.md`.

### 4.3 WhatsApp tenant routing
```bash
STAGE=dev AWS_REGION=us-east-1 npm run seed:whatsapp-mappings
```

### 4.4 Telegram tenant routing
```bash
STAGE=dev AWS_REGION=us-east-1 npm run seed:telegram-bot-mappings
```

## 5) WhatsApp tests (manual)

- Ensure webhook configured in Meta:
  - `{API_BASE_URL}/webhooks/whatsapp`
- Send message to the WhatsApp number.
- Verify logs:
  - webhook ingested
  - tenant resolved via `phone_number_id`
  - message enqueued to inbound queue
  - orchestrator responded

## 6) Telegram tests (manual)

- setWebhook points to:
  - `{API_BASE_URL}/webhooks/telegram/{botKey}`
- Send message to the bot.
- Verify logs and SQS ingestion.

## Troubleshooting

- If Telegram webhook requests are rejected, confirm `TELEGRAM_WEBHOOK_SECRET_TOKEN` matches your setWebhook configuration.
- If WhatsApp webhook signature validation fails, confirm the Meta app secret is correct and that the handler uses the raw body for HMAC.
