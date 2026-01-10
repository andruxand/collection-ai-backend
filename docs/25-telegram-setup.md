# Telegram setup (end-to-end)

This guide explains how to configure **Telegram webhooks** for this backend and how to run it **multi-tenant** in production.

## Multi-tenant strategy

Telegram updates do not include a stable "phone-number-id" equivalent like WhatsApp.

For multi-tenant production, this backend uses:

- Webhook path includes a `botKey`:
  - `POST /webhooks/telegram/{botKey}`
- Dynamo mapping:
  - `pk = TG_BOT#<botKey>`
  - `sk = TENANT`
  - `tenantId = <tenantId>`

This lets you run **one bot per tenant** (recommended) or one bot per brand.

## Prerequisites

- A Telegram account.
- Create a bot via `@BotFather` and obtain its **bot token**.
- A public HTTPS endpoint:
  - `{API_BASE_URL}/webhooks/telegram/{botKey}`

## Webhook security (recommended)

Telegram supports `secret_token` when setting the webhook. When configured, Telegram will include:
- `X-Telegram-Bot-Api-Secret-Token` header in every webhook request.

This backend checks that header when `TELEGRAM_WEBHOOK_SECRET_TOKEN` is set.

## Configure env vars

- `TELEGRAM_WEBHOOK_SECRET_TOKEN` (optional but recommended)
- `TABLE_NAME`
- `INBOUND_QUEUE_URL`

## Create the botKey → tenant mapping

Put JSON files under `configs/telegram-bot-mappings/` and run:

```bash
TABLE_NAME=... npm run seed:telegram-bot-mappings
```

Example file: `configs/telegram-bot-mappings/tenant-demo.json`

## Configure setWebhook

Use `setWebhook` to point Telegram to your endpoint. Example (conceptual):

- URL: `{API_BASE_URL}/webhooks/telegram/tg-demo`
- secret_token: value of `TELEGRAM_WEBHOOK_SECRET_TOKEN`

After that, send a message to the bot in Telegram and check CloudWatch logs to confirm ingestion.
