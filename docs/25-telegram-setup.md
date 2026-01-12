## Configuración segura de tokens de bot (multi-tenant)

Para cada tenant que use Telegram, debes crear un secreto en AWS Secrets Manager con el token de su bot:

- **Nombre sugerido:** `telegram-bot-token-<nombre-tenant>-<stage>`
- **Valor:**
  - Tipo: key/value (JSON)
  - Key: `token`
  - Value: el token que te da BotFather (ejemplo: `123456789:AAE...`)

Ejemplo en AWS Console:
1. Secrets Manager → Store a new secret → Other type of secret
2. Key: `token` | Value: `<tu token>`
3. Nombre: `telegram-bot-token-tenant-demo-dev`
4. Guarda el ARN generado.

En el JSON del tenant (`configs/tenant-demo.json`):
```json
  "telegram": {
    "botTokenSecretId": "arn:aws:secretsmanager:us-east-1:123456789012:secret:telegram-bot-token-tenant-demo-dev-abc123"
  }
```

El backend, al enviar mensajes, recupera el token usando ese ARN y la clave `token`.

**Nunca pongas el token real en el JSON ni en variables de entorno.**

### Mappings y ruteo multi-tenant

El archivo `configs/telegram-bot-mappings/tenant-demo.json` solo asocia un `botKey` con un `tenantId`:
```json
{
  "botKey": "tg-demo",
  "tenantId": "tenant-demo"
}
```
Esto permite que el backend rutee webhooks de Telegram al tenant correcto, pero el token real siempre se obtiene vía Secrets Manager según el JSON del tenant.
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

- Una cuenta de Telegram.
- Crear un bot vía `@BotFather` y obtener su **bot token**.
- Un endpoint HTTPS público:
  - `{API_BASE_URL}/webhooks/telegram/{botKey}`

Para preparar rápidamente el entorno `dev` con datos de ejemplo:
```bash
npm i
npm run deploy:dev
npm run onboard:telegram-dev
```

## Webhook security (recommended)

Telegram supports `secret_token` when setting the webhook. When configured, Telegram will include:
- `X-Telegram-Bot-Api-Secret-Token` header in every webhook request.

This backend checks that header when `TELEGRAM_WEBHOOK_SECRET_TOKEN` is set.

## Configure env vars

- `TELEGRAM_WEBHOOK_SECRET_TOKEN` (opcional pero recomendado).
  - Es un valor global por stage (no un ARN) que se guarda como **SecureString** en SSM, p.ej.
    `/collections-ai-mvp/dev/telegramWebhookSecretToken`.
  - `serverless.ts` lo inyecta en la Lambda usando `${ssm:/...}` y el handler compara el
    header `X-Telegram-Bot-Api-Secret-Token` directamente contra `process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN`.
- `TABLE_NAME` y `INBOUND_QUEUE_URL` se inyectan desde `serverless.ts` en tiempo de deploy.

## Create the botKey → tenant mapping

Si usas `npm run onboard:telegram-dev`, ya se aplican los mappings de ejemplo
definidos en `configs/telegram-bot-mappings/*.json` (por defecto, `tg-demo` → `tenant-demo`).

Para ejecutar el seed manualmente (u otro `STAGE`):

```bash
STAGE=dev AWS_REGION=us-east-1 npm run seed:telegram-bot-mappings
```

Ejemplo de archivo: `configs/telegram-bot-mappings/tenant-demo.json`

## Configure setWebhook

Hoy **el backend no llama `setWebhook` por ti**. Debes hacerlo tú contra la API de Telegram para cada bot.

1. Obtén el `BOT_TOKEN` desde `@BotFather`.
2. Usa tu `HttpApiUrl` del deploy, por ejemplo:
   - `HttpApiUrl = https://g16qwvymqa.execute-api.us-east-1.amazonaws.com`
   - Webhook final: `https://g16qwvymqa.execute-api.us-east-1.amazonaws.com/webhooks/telegram/tg-demo`
3. Llama a `setWebhook` así:

```bash
BOT_TOKEN="<TU_BOT_TOKEN_DE_BOTFATHER>"
WEBHOOK_URL="<HttpApiUrl>/webhooks/telegram/tg-demo"
SECRET_TOKEN="<MISMO_VALOR_QUE_EN_SSM_TELEGRAM_WEBHOOK_SECRET_TOKEN>"

curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}&secret_token=${SECRET_TOKEN}"
```

Después de eso:
- Envía un mensaje al bot en Telegram.
- Revisa CloudWatch Logs:
  - Función `telegramWebhook` debe registrar el update y encolar en SQS.
  - Función `orchestrator` debe procesar el mensaje.