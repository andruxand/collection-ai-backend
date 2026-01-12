# Tenant Configuration (MVP, no frontend)

Tenants are stored in DynamoDB as:
- `pk = TENANT#<tenantId>`
- `sk = META`

You can create/update them via:
1) **Admin API**: `POST /admin/tenant` (preferred in MVP)
2) **Seed script**: `node scripts/seedTenant.js configs/tenant-demo.json`

## Admin API: upsert tenant
Endpoint:
- `POST /admin/tenant`
Headers:
- `X-Api-Key: <adminApiKey>`
Body:
```json
{
  "tenantId": "tenant-demo",
  "name": "Demo Tenant",
  "channels": {
    "whatsapp": { "phoneNumberId": "...", "accessTokenSecretId": "<ARN de Secrets Manager>" },
    "telegram": { "botTokenSecretId": "<ARN de Secrets Manager>" }
  },
  "policy": {
    "contactPolicy": { "...": "..." },
    "contactLimitsByStage": {
      "EARLY": { "maxOutboundPerDay": 1, "maxOutboundPerWeek": 1 },
      "MID":   { "maxOutboundPerDay": 1, "maxOutboundPerWeek": 3 },
      "LATE":  { "maxOutboundPerDay": 1, "maxOutboundPerWeek": 4 }
    },
    "auditPolicy": { "retentionDays": 90, "storeMessageText": true, "storeDecisionPayloads": true },
    "exportPolicy": { "enabled": false },
    "handoffPolicy": { "enabled": true, "stageMin": "MID", "intents": ["DISPUTE","ANGRY"] },
    "cooldowns": { "rejectedOfferDays": 3, "noResponseDays": 2, "brokenPromiseDays": 1 },
    "offerPolicy": { "ladder": [{"attempt":1,"maxDiscountPct":0}], "maxAttempts": 6, "hardCapDiscountPct": 15 },
    "tonePolicy": { "T1": "amable", "T2": "directo", "T3": "formal" }
  }
}
```

## Export audit (optional)
Endpoint:
- `POST /admin/export/audit`
Body:
```json
{ "tenantId": "tenant-demo", "date": "2026-01-02" }
```
Requires `policy.exportPolicy.enabled=true` and `policy.exportPolicy.s3Bucket`.

## Seed Script
```bash
export TABLE_NAME=collections-ai-mvp-dev-core
export AWS_REGION=us-east-1
node scripts/seedTenant.js configs/tenant-demo.json
```


## Handoff ops
- List: `GET /admin/handoffs?tenantId=<id>`
- Close: `POST /admin/handoffs/close`

## LLM behavior (ops)
The system is deterministic by default (policy + offer engine + NBA). An optional rewrite step can make replies more natural without changing meaning.

Environment toggle:
- `LLM_REWRITE_ENABLED=false` disables rewrite (useful for debugging and strict environments).

## Conversational strategy (per tenant)
You can configure a tenant-specific **objective** and **tone strategy** based on the debt context.

This allows different goals depending on `daysPastDue` and/or `totalDueCop` (and optionally `stage`):
- `NUDGE`: soft, informational, confirm intent
- `NEGOTIATE`: focus on agreement (discount/installments)
- `COLLECT_NOW`: prioritize payment today when viable
- `PROMISE`: prioritize capturing promise date/amount
- `VERIFY`: prioritize verification (already paid / dispute)

Example:
```json
"strategyPolicy": {
  "defaultObjective": "NEGOTIATE",
  "objectivePlaybook": {
    "COLLECT_NOW": {
      "goal": "Cerrar pago hoy si el usuario está dispuesto; si no, pasar a acuerdo.",
      "primaryAction": "SEND_PAYMENT_LINK",
      "secondaryAction": "SHOW_OFFERS"
    },
    "NEGOTIATE": {
      "goal": "Cerrar un acuerdo viable hoy y avanzar a pago/promesa.",
      "primaryAction": "SHOW_OFFERS",
      "secondaryAction": "ASK_SLOT"
    },
    "PROMISE": {
      "goal": "Capturar fecha+monto y registrar promesa.",
      "primaryAction": "ASK_SLOT",
      "secondaryAction": "CREATE_PROMISE"
    },
    "NUDGE": {
      "goal": "Confirmar intención sin presionar y llevar a una opción concreta.",
      "primaryAction": "CLARIFY",
      "secondaryAction": "SHOW_DETAIL"
    },
    "VERIFY": {
      "goal": "Verificar pago/disputa antes de insistir.",
      "primaryAction": "ACK_ALREADY_PAID",
      "secondaryAction": "ACK_DISPUTE"
    }
  },
  "rules": [
    { "when": { "maxDaysPastDue": 7 }, "objective": "NUDGE", "toneKey": "T1" },
    { "when": { "minDaysPastDue": 60 }, "objective": "COLLECT_NOW", "toneKey": "T3" },
    { "when": { "minTotalDueCop": 2000000 }, "objective": "COLLECT_NOW", "toneKey": "T3" }
  ]
}
```

Notes:
- Rules are evaluated in order (first match wins).
- `toneKey` references `tonePolicy.T1/T2/T3`.

Playbook enforcement (runtime):
- When `DIALOGUE_MANAGER_ENABLED=true` and an `objectivePlaybook` exists for the matched objective, the runtime may enforce `primaryAction` (or `secondaryAction`) **only** to prevent menu-loop actions (`FALLBACK_MENU` / `REDIRECT_MENU`).
- Enforcement is conservative and will not override sensitive intents like `DISPUTE`/`ANGRY`.
- When an enforcement happens, the audit payload includes `dm.enforcement` to explain the override.


## Notifications
Configure email notifications:
```json
"notificationPolicy": {
  "email": {
    "enabled": true,
    "fromAddress": "verified-ses-sender@example.com",
    "toAddresses": ["ops@example.com"],
    "subjectPrefix": "[CollectionsAI]",
    "includeInboundText": true
  }
}
```


## Seeding client API keys (no UI)

El `API_KEY_PEPPER` es un valor global por stage que el backend usa para hashear y validar API keys de cliente. En AWS lo guardas como **SecureString** en SSM (por ejemplo `/collections-ai-mvp/dev/apiKeyPepper`) y `serverless.ts` lo inyecta como `process.env.API_KEY_PEPPER` usando `${ssm:/...}`.

Para un seed local/manual puedes exportar el valor real (no el ARN) y ejecutar:

```
API_KEY_PEPPER=... TABLE_NAME=... AWS_REGION=... node scripts/seedTenant.js configs/tenant-demo.json --issue-client-key --label "Prod integration"
```


## Inviting platform users (no UI)
```
PLATFORM_USER_POOL_ID=... TABLE_NAME=... AWS_REGION=... node scripts/seedTenant.js configs/tenant-demo.json --invite-user ops1@company.com --role OPERATOR --tenant-ids tenant-demo
```
