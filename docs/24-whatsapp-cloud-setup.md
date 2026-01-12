# WhatsApp Cloud API setup (end-to-end)

This guide explains how to configure **WhatsApp Cloud API** to send inbound messages to this backend via webhooks, and how to validate and route those messages in a **multi-tenant** setup.

## What you will build

- A public HTTPS webhook endpoint (API Gateway + Lambda).
- Verification handshake (GET challenge).
- Signature validation for POST payloads (X-Hub-Signature-256).
- Multi-tenant routing using WhatsApp `phone_number_id` → `tenantId` mapping in DynamoDB.

## Prerequisites

### Accounts and access
- A Meta Developer account.
- A Meta app with the WhatsApp product enabled.
- A WhatsApp Business Account (WABA) and a phone number connected to Cloud API.

### Infrastructure
- AWS account con permisos para:
   - Lambda, API Gateway (HTTP API)
   - DynamoDB
   - SQS
   - Secrets Manager
   - CloudWatch Logs
- Un stage desplegado de este backend (dev/staging) que exponga:
   - `ANY /webhooks/whatsapp` (ver `serverless.ts`)

Para un entorno de pruebas rápido en `dev`:
```bash
npm i
npm run deploy:dev
npm run onboard:whatsapp-dev
```

## Costs and key platform rules

- WhatsApp Business Platform pricing depends on message category/market and can change over time. Always confirm current pricing before launch.
- WhatsApp has messaging constraints (e.g., templates may be required outside the customer-service window). Validate policy and template requirements during MVP.

## Configure secrets y parámetros (AWS)

Este backend espera:

- **Meta App Secret** en Secrets Manager (referenciado por ARN):
   1. Crea un secreto en Secrets Manager con el **App Secret** de tu app de Meta como string.
   2. Guarda el ARN (lo usarás en `serverless.ts` o en SSM, según tu estrategia).

- **Access token de WhatsApp Cloud API** en Secrets Manager:
   - Crea un secreto con el access token actual.
   - Usa el ARN en la configuración de canal del tenant (`channels.whatsapp.accessTokenSecretId`).

- **Parámetros SSM por stage** (ejemplo para `service=collections-ai-mvp`, `stage=dev`):
   - `/collections-ai-mvp/dev/metaVerifyToken`
   - `/collections-ai-mvp/dev/metaAppSecretArn`
   - `/collections-ai-mvp/dev/adminApiKey`

Variables de entorno relevantes para runtime (inyectadas por `serverless.ts`):
- `TABLE_NAME` (derivada como `${service}-${stage}-core`)
- `INBOUND_QUEUE_URL`

## Configure the webhook in Meta

1. In Meta Developer console, open your app → WhatsApp → Configuration.
2. Set Callback URL to:
   - `{API_BASE_URL}/webhooks/whatsapp`
3. Set Verify Token to the same value as `WHATSAPP_VERIFY_TOKEN`.

### Verification handshake

Meta will call your endpoint with a GET request containing:
- `hub.mode`
- `hub.verify_token`
- `hub.challenge`

Your webhook handler must return the `hub.challenge` when the verify token matches.

## Multi-tenant routing (required for production)

WhatsApp webhooks include the `phone_number_id` used to receive the message.

This backend maps:
- `pk = WA_PHONE#<phoneNumberId>`
- `sk = TENANT`
- `tenantId = <tenantId>`

### Seed the mapping

Create JSON files under `configs/whatsapp-mappings/` and run:

```bash
TABLE_NAME=... npm run seed:whatsapp-mappings
```

## Smoke test checklist

1. Deploy the backend (API Gateway URL).
2. Configure webhook in Meta.
3. Seed `WA_PHONE` mapping for your WhatsApp number.
4. Send a WhatsApp message to the number.
5. Verify in CloudWatch:
   - webhook received
   - tenant resolved
   - message enqueued to inbound SQS
   - orchestrator processed and responded (if your outbound send is enabled)
