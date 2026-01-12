# Copilot Instructions — Collections AI Backend

## Big picture
- This package is the **backend** for Collections AI MVP v2: Serverless Framework v3 + TypeScript, deployed on AWS (Lambda + HTTP API, DynamoDB, SQS, Cognito, SES, Secrets Manager, SSM).
- The core domain (collections workflows, policies, NLU, offers, handoff) lives under `src/core/**`.
- Lambda entrypoints are small handlers under `src/handlers/**` that:
  - Validate/authenticate requests (admin API key, platform JWT, client API keys).
  - Normalize inbound channel events (WhatsApp, Telegram) into a common shape.
  - Call core services and enqueue/dequeue messages.
- Infrastructure and wiring (functions, queues, table, Cognito, env vars) are defined in `serverless.ts`.

## Architecture & data model
- **Core modules** (keep business logic here, not in handlers):
  - Channel senders: `src/core/channels/whatsappSender.ts`, `telegramSender.ts`.
  - NLU: `src/core/nlu/**` (Zod schemas + parsing helpers).
  - LLM: `src/core/llm/**` (client, prompts, response writer, safety filter).
  - Offers & NBA: `src/core/offers/**`, `src/core/nba/**`.
  - Policy: `src/core/policy/**` (effective policy resolution, checks vs country baseline + tenant overrides).
  - Store: `src/core/store/**` (DynamoDB access, repos, audit, tenant resolution, routing).
  - Tenant defaults: `src/core/tenant/defaults.ts`.
  - Shared types & errors: `src/core/types.ts`, `src/core/errors.ts`.
- **Handlers** in `src/handlers/**` should:
  - Be thin, stateless, and call into `core` or `store` modules.
  - Never embed policy or business rules directly; add or reuse helpers in `core`.
  - Use the existing patterns in files like `orchestrator.ts`, `whatsappWebhook.ts`, `telegramWebhook.ts` as templates for new endpoints.
- **Data model** is documented in `docs/02-data-model.md` and backed by a single DynamoDB table (CoreTable) defined in `serverless.ts`.
  - Partition/sort keys and GSIs are fixed; follow existing patterns in `src/core/store/repos.ts` instead of inventing new key shapes.

- **Country vs tenant policies** (importante para evitar duplicados/confusión):
  - `CountryPolicy` (seed desde `configs/policy-templates/*.json`) solo debe contener el baseline legal por país:
    - `contactPolicy` (timezone, canales permitidos, maxContactsPerDay, flags y ventanas horarias).
    - `contactLimitsByStage`.
    - `cooldowns` mínimos (noResponseDays, brokenPromiseDays).
  - `TenantPolicy` (dentro del JSON del tenant, por ejemplo `configs/tenant-demo.json`) contiene los knobs específicos del cliente:
    - `offerPolicy`, `auditPolicy`, `exportPolicy`, `notificationPolicy`, `handoffPolicy`, `tonePolicy`.
  - **No** añadas ni dupliques `offerPolicy`, `notificationPolicy`, `handoffPolicy`, etc. en las plantillas de país; el código solo las lee desde el tenant.
  - Si necesitas que un campo exista tanto en país como en tenant, primero actualiza los tipos en `src/core/types.ts` y el merge en `src/core/policy/effectivePolicy.ts`, y documenta claramente el comportamiento en `docs/14-country-policies.md`.

## Serverless & env conventions
- `serverless.ts` is a **CommonJS** module (for Serverless v3 + ts-node):
  - Do **not** reintroduce `export default` or ESM syntax; keep `module.exports = config`.
  - `package.json` must **not** declare `"type": "module"`.
- Deployment bucket and versioning:
  - All deployments use a single S3 bucket per account/region: `${service}-${aws:accountId}-${aws:region}-deployments`.
  - Lambda versioning is disabled globally with `provider.versionFunctions = false`.
- Environment variables:
  - Global envs are defined under `provider.environment` in `serverless.ts`.
  - Sensitive values come from SSM and Secrets Manager (see `docs/05-runbook.md` and `README.md`).
  - When adding new secrets, prefer **Secrets Manager** and reference by ARN; do not hard‑code secrets in code.

## Workflows: build, deploy, seed, test
- **Build/package**:
  - `npm run build` → `serverless package` (requires at least `API_KEY_PEPPER` set in your local env).
- **Deploy dev**:
  - `npm run deploy:dev` (uses AWS profile from `serverless.ts`, default `adrian-personal`).
  - Ensure required SSM params and secrets exist (see `docs/05-runbook.md`).
- **Onboarding (dev) — patrón recomendado**:
  - Usa comandos de alto nivel que orquestan todos los seeds necesarios por canal:
    - Telegram: `npm run onboard:telegram-dev`.
    - WhatsApp: `npm run onboard:whatsapp-dev`.
  - Estos comandos internamente llaman a `scripts/onboard-stage.mjs`, que:
    - Resuelve `TABLE_NAME` a partir de `STAGE` y `SERVICE_NAME` (`scripts/config.js`).
    - Ejecuta en orden: políticas de país → mappings de canal → tenant demo.
  - Cuando añadas nuevos canales o seeds, **extiende este orquestador** en lugar de crear comandos sueltos.
- **Seed data manual (otros stages / usos avanzados)**:
  - Country policies: `STAGE=... AWS_REGION=... npm run seed:country-policies` (lee `configs/policy-templates/`).
  - WhatsApp routing: `STAGE=... AWS_REGION=... npm run seed:whatsapp-mappings` (JSON bajo `configs/whatsapp-mappings/`).
  - Telegram bot routing: `STAGE=... AWS_REGION=... npm run seed:telegram-bot-mappings` (JSON bajo `configs/telegram-bot-mappings/`).
  - Tenant + demo data: `STAGE=... AWS_REGION=... node scripts/seedTenant.js configs/tenant-demo.json`.
  - Client API key: añade flags `--issue-client-key` como en `docs/05-runbook.md` y `docs/07-tenant-config.md`.
- **Tests**:
  - Unit/integration: `npm test` or `npm run test:watch` (Vitest, see `vitest.config.ts`).
  - Follow existing tests in `src/core/**.test.ts` and `src/handlers/orchestrator.test.ts` when adding new behavior.

## Patterns to follow
- Prefer **functional composition** over classes; most modules export pure functions.
- Keep handlers small:
  - Parse/validate inputs.
  - Resolve tenant/context (often via store helpers like `resolveTenantFromTelegramBotKey`).
  - Call a core service.
  - Map results to HTTP or queue messages.
- Use **Zod** schemas for external payloads and configuration validation (see `src/core/nlu/schema.ts` and related modules) instead of ad‑hoc runtime checks.
- For DynamoDB access:
  - Use `src/core/store/repos.ts` and related store modules; do not call AWS SDK clients directly from handlers.
  - Follow existing key naming and item shapes (`pk`, `sk`, `gsi1pk`, `gsi1sk`).
- For channels:
  - Normalize external payloads into the `NormalizedInboundEvent` shape (`src/core/types.ts`) as done in `telegramWebhook.ts` and `whatsappWebhook.ts`.

## Cross‑repo context (frontend)
- The frontend monorepo lives in `collections-ai-frontend/` and has its own rules in `.cursorrules` plus `docs/AI_CONTEXT.md`.
- Backend HTTP API contracts are shared via the `api-contracts` package and documented in `collections-ai-frontend/docs/BACKEND_ENDPOINTS.md` and backend `docs/31-api-contracts.md`.
- When changing backend endpoints, update:
  - Serverless function definitions in `serverless.ts`.
  - Handler implementation in `src/handlers/**`.
  - API contracts in the shared `api-contracts` package and sync docs as needed.

## When in doubt
- Start from the docs index: `collections-ai-backend/docs/00-overview.md` and `docs/05-runbook.md`.
- Use existing handlers and core modules as templates; align with their patterns rather than inventing new ones.
- Ask before introducing new AWS resources or changing table/index schemas; this impacts multiple parts of the system.
