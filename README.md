# Deploy y perfil AWS (mejor práctica)

Para que todos los despliegues usen el perfil AWS correcto y sean escalables:

1. Define el perfil en un archivo `.env` en la raíz del backend:
  ```env
  AWS_PROFILE=adrian-personal
  ```
2. Los scripts de deploy en `package.json` usan `cross-env` para soportar variables de entorno multiplataforma:
  ```json
  "deploy:dev": "cross-env serverless deploy --stage dev --aws-profile=$AWS_PROFILE --verbose"
  ```
3. Así puedes cambiar de cuenta/rol fácilmente y evitar errores por perfil default.

> Si usas CI/CD, exporta AWS_PROFILE en el job antes de ejecutar cualquier comando de deploy.

# Collections AI MVP v2 (WhatsApp Cloud API + Telegram)

Serverless Framework + Node 22 (runtime Lambda) + TypeScript.

## Novedades de esta versión
- Ingesta: `/admin/debtors` para upsert masivo de morosos (JSON) con lookup por phone/telegram.
- LLM OpenAI: **Responses API** + **Structured Outputs** (JSON Schema) para NLU (intents/entities).
- Policy realista para Colombia:
  - Timezone America/Bogota
  - Feriados CO (date-holidays)
  - Regla “no multicanal por 7 días tras contacto directo” (configurable)
  - Cooldown (campo nextContactAllowedAt)

## Deploy y onboarding rápido

```bash
npm i
npm run deploy:dev
```

Luego, según el canal que quieras probar primero:

- **Telegram (recomendado para empezar)**
  ```bash
  npm run onboard:telegram-dev
  ```

- **WhatsApp**
  ```bash
  npm run onboard:whatsapp-dev
  ```

Los comandos de onboarding aplican seeds de políticas, routing de canal y tenant demo para el `STAGE=dev`.

Notas de configuración de Serverless + TypeScript:
- `package.json` **no** declara `"type": "module"` para que Serverless pueda cargar `serverless.ts` vía `ts-node` usando `require`.
- `serverless.ts` exporta la configuración con `module.exports = config` (CommonJS), no con `export default`.
- Los artefactos de despliegue se almacenan en un único bucket S3 compartido: `${self:service}-${aws:accountId}-${aws:region}-deployments`.
- La creación de nuevas versiones de Lambda en cada deploy está desactivada (`versionFunctions: false` en `provider`).

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
