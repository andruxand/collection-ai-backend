# Country policies (jurisdiction baseline)

This product is multi-tenant **and** multi-country. Each country can have different legally allowed:
- contact windows (hours, days, holidays)
- contact frequency caps
- allowed channels (WhatsApp / Telegram / Voice in the future)
- minimum cooldown rules (how long to wait after "no response" or "broken promise")

To support this without redeploys, **country policies are stored in DynamoDB** and combined with each tenant policy at runtime.

## Data model (DynamoDB)

A policy is stored as a single item:

- `pk = COUNTRY#<COUNTRY_CODE>` (e.g. `COUNTRY#CO`)
- `sk = POLICY`

Registry item (for listing countries without scans):

- `pk = COUNTRIES`
- `sk = COUNTRY#<COUNTRY_CODE>`

## Runtime behavior
> ⚠️ **Nota importante:**
> La propiedad `channelsAllowed` (por ejemplo, `{ whatsapp: true, telegram: true }`) es **obligatoria** tanto en las políticas de país como en las de tenant. Si falta, el backend puede lanzar errores en tiempo de ejecución. Siempre define explícitamente los canales permitidos en cada política.
At runtime, the backend builds an **Effective Policy**:

1. Load tenant policy (tenant record)
2. Load country policy by `tenant.policy.contactPolicy.countryCode`
3. Combine them: `effective = buildEffectivePolicy(country, tenantPolicy)`

Rules:
- Tenant can only become **more strict** than the country baseline.
- Caps (max contacts) use **min(country, tenant)**.
- Cooldowns use **max(country, tenant)** (waiting longer is more strict).
- Hours are intersected (the window can only shrink).
- Allowed channels are intersected.

If a country policy is missing (seed not executed), the system falls back to the tenant policy, but this should be avoided in production.

### Qué debe ir en CountryPolicy vs TenantPolicy

- **CountryPolicy** (plantillas en `configs/policy-templates/*.json`) solo debe contener el baseline legal/jurisdiccional:
	- `contactPolicy` (timezone, canales permitidos, `maxContactsPerDay`, flags y ventanas horarias).
	- `contactLimitsByStage`.
	- `cooldowns` mínimos (`noResponseDays`, `brokenPromiseDays`).

- **TenantPolicy** (dentro del JSON del tenant, por ejemplo `configs/tenant-demo.json`) contiene los knobs propios del cliente/empresa:
	- `offerPolicy`, `auditPolicy`, `exportPolicy`, `notificationPolicy`, `handoffPolicy`, `tonePolicy`.

No dupliques estos bloques de TenantPolicy dentro de las plantillas de país: el código solo lee esos campos desde el tenant y tenerlos en ambos sitios genera confusión sin efecto real en runtime.

## Seeding (mock / seed)

We ship JSON policy packs under:

- `configs/policy-templates/*.json`

Seed them into DynamoDB:

```bash
STAGE=dev AWS_REGION=us-east-1 npm run seed:country-policies
```

## Files to review

- `src/core/policy/effectivePolicy.ts` (combines tenant + country)
- `src/core/store/repos.ts` (`putCountryPolicy`, `getCountryPolicy`)
- `scripts/seed-country-policies.mjs` (seed script)
