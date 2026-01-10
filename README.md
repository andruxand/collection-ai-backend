# Collections AI MVP v2 (WhatsApp Cloud API + Telegram)

Serverless Framework + Node 20 + TypeScript.

## Novedades de esta versión
- Ingesta: `/admin/debtors` para upsert masivo de morosos (JSON) con lookup por phone/telegram.
- LLM OpenAI: **Responses API** + **Structured Outputs** (JSON Schema) para NLU (intents/entities).
- Policy realista para Colombia:
  - Timezone America/Bogota
  - Feriados CO (date-holidays)
  - Regla “no multicanal por 7 días tras contacto directo” (configurable)
  - Cooldown (campo nextContactAllowedAt)

## Deploy
```bash
npm i
npm run deploy:dev
```

## Config (SSM)
- /collections-ai-mvp/dev/metaVerifyToken
- /collections-ai-mvp/dev/metaAppSecretArn
- /collections-ai-mvp/dev/adminApiKey

## Config (Secrets)
- WhatsApp access token (META_ACCESS_TOKEN_SECRET_ID)
- Telegram bot token (TELEGRAM_BOT_TOKEN_SECRET_ID)
- OpenAI api key (LLM_OPENAI_KEY_SECRET_ID)

## Activar OpenAI
En `serverless.ts` deja envs así (o mapea desde SSM):
- `LLM_PROVIDER_JSON='{"provider":"openai","model":"gpt-4o-mini"}'`
- `LLM_OPENAI_KEY_SECRET_ID='<secret arn/id>'`

## Ingesta de morosos
POST `/admin/debtors`
Headers:
- `X-Api-Key: <adminApiKey>`

Body:
```json
{
  "tenantId": "tenant-demo",
  "debtors": [
    { "phoneE164": "+573001112233", "totalDueCop": 980000, "daysPastDue": 37, "dueDate": "2025-12-15", "consents": { "whatsapp": true } }
  ]
}
```


## Documentation
See `docs/` folder. Start with `docs/00-overview.md`.


## Testing
See `docs/TESTING.md`.
