# Runbook

## Deploy

### Perfil AWS recomendado

Para que Serverless use siempre el perfil correcto y evitar errores de permisos:

1. Define el perfil en `.env`:
  ```env
  AWS_PROFILE=adrian-personal
  ```
2. Los scripts de deploy usan `cross-env` para soportar variables de entorno multiplataforma:
  ```json
  "deploy:dev": "cross-env serverless deploy --stage dev --aws-profile=$AWS_PROFILE --verbose"
  ```
3. Así puedes cambiar de cuenta/rol fácilmente y mantener despliegues consistentes.

En CI/CD, exporta AWS_PROFILE antes de cualquier comando de deploy.
```bash
npm i
npm run deploy:dev
```

### Onboarding rápido por canal

Entorno asumido: `STAGE=dev`, `AWS_REGION=us-east-1`.

- **Telegram (recomendado para empezar)**
  ```bash
  npm run onboard:telegram-dev
  ```
  Esto aplica seeds para:
  - Políticas de país (DynamoDB)
  - Mapeos `TG_BOT#botKey -> tenantId`
  - Tenant demo (`tenant-demo`)

- **WhatsApp**
  ```bash
  npm run onboard:whatsapp-dev
  ```
  Esto aplica seeds para:
  - Políticas de país
  - Mapeos `WA_PHONE#phoneNumberId -> tenantId`
  - Tenant demo

### Notas Serverless + TypeScript
- `package.json` **no** debe incluir `"type": "module"`, ya que Serverless (v3) carga `serverless.ts` mediante `require` + `ts-node`.
- La exportación en `serverless.ts` es CommonJS: `module.exports = config`.
- Runtime configurado para Lambda: `nodejs22.x`.

### Bucket único de despliegue
- Los artefactos de despliegue de Serverless se suben a un único bucket S3 por cuenta/región:
  - Nombre: `${service}-${aws:accountId}-${aws:region}-deployments`
  - Cifrado: `AES256`.
- El bucket lo crea y gestiona CloudFormation en el **primer** deploy:
  - No es necesario crearlo a mano.
  - Debes tener permisos S3 `CreateBucket`, `PutObject`, `GetObject` en esa cuenta.

#### Cambiar el bucket (opcional)
- Editar `provider.deploymentBucket.name` en `serverless.ts`.
- Asegúrate de que el nombre sea globalmente único en S3 y todo minúsculas.
- Si apuntas a un bucket existente, debe crearse fuera de CloudFormation y tener política que permita al rol de deploy subir artefactos.

### Política de versionado de Lambda
- Para evitar que cada deploy cree una nueva versión de cada función Lambda, se usa:
  - `provider.versionFunctions = false` en `serverless.ts`.
- Implicaciones:
  - No se generan versiones numeradas ni aliases automáticos.
  - Todos los invokes van siempre contra la última versión desplegada.
- Si necesitas canary/blue‑green con aliases, deberás volver a activar versiones:
  - Cambiar `versionFunctions` a `true` y ajustar la estrategia de despliegue.

## SSM vs Secrets Manager (cómo se inyectan en el backend)

Hay dos patrones distintos:

- **SSM Parameter Store → valor directo en variable de entorno**
  - Usamos `${ssm:/...}` en `serverless.ts`.
  - Serverless resuelve el valor en deploy y la Lambda ve el **valor real** en `process.env`, no el ARN.
  - Ejemplos (por stage):
    - `/collections-ai-mvp/dev/metaVerifyToken` → `META_VERIFY_TOKEN`
    - `/collections-ai-mvp/dev/metaAppSecretArn` → `META_APP_SECRET_ARN` (contiene un ARN)
    - `/collections-ai-mvp/dev/adminApiKey` → `ADMIN_API_KEY`
    - `/collections-ai-mvp/dev/apiKeyPepper` → `API_KEY_PEPPER`
    - `/collections-ai-mvp/dev/telegramWebhookSecretToken` → `TELEGRAM_WEBHOOK_SECRET_TOKEN`

- **Secrets Manager → ARN en config + fetch en runtime**
  - Para secretos por canal/tenant guardamos el **ARN** del secreto (no el valor) en config/env.
  - El código usa AWS Secrets Manager (`GetSecretValue`) para leer el valor real en runtime.
  - Ejemplos:
    - `META_APP_SECRET_ARN` (desde SSM) apunta a un secreto con el App Secret de Meta.
    - `channels.whatsapp.accessTokenSecretId` apunta al secreto con el access token de WhatsApp.
    - `channels.telegram.botTokenSecretId` apunta al secreto con el token del bot de Telegram.

Regla práctica:
- **Global por stage** (pepper, adminApiKey, verify tokens, webhook secrets) → valor en SSM (SecureString) → env var con el valor directo.
- **Por tenant/canal** (tokens de WhatsApp/Telegram, claves LLM, etc.) → secreto en Secrets Manager → se referencia por ARN en config y el backend hace `GetSecretValue`.

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




## Seeds manuales (solo si no usas los comandos onboard)

Si prefieres ejecutar los seeds a mano (por ejemplo, en otro `STAGE`):

- **Políticas de país (requerido)**
  ```bash
  STAGE=dev AWS_REGION=us-east-1 npm run seed:country-policies
  ```

- **Routing WhatsApp**
  ```bash
  STAGE=dev AWS_REGION=us-east-1 npm run seed:whatsapp-mappings
  ```
  Mappings en `configs/whatsapp-mappings/*.json`:
  - `phoneNumberId` (WhatsApp Cloud API `metadata.phone_number_id`)
  - `tenantId`

- **Routing Telegram**
  ```bash
  STAGE=dev AWS_REGION=us-east-1 npm run seed:telegram-bot-mappings
  ```
  Mappings en `configs/telegram-bot-mappings/*.json`:
  - `botKey`
  - `tenantId`

- **Tenant demo / API keys / usuarios de plataforma**
  ```bash
  STAGE=dev AWS_REGION=us-east-1 node scripts/seedTenant.js configs/tenant-demo.json

  # Emitir API key de cliente (impresa una sola vez)
  API_KEY_PEPPER=... STAGE=dev AWS_REGION=us-east-1 \
    node scripts/seedTenant.js configs/tenant-demo.json \
    --issue-client-key --label "Prod integration"

  # Invitar usuario de plataforma
  PLATFORM_USER_POOL_ID=... STAGE=dev AWS_REGION=us-east-1 \
    node scripts/seedTenant.js configs/tenant-demo.json \
    --invite-user ops1@company.com --role OPERATOR --tenant-ids tenant-demo
  ```
