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

## Seeding (mock / seed)

We ship JSON policy packs under:

- `config/country-policies/*.json`

Seed them into DynamoDB:

```bash
# set your Dynamo table name in env
export TABLE_NAME="<your-dynamo-table-name>"

# seed all policies from config/country-policies
npm run seed:country-policies
```

## Files to review

- `src/core/policy/effectivePolicy.ts` (combines tenant + country)
- `src/core/store/repos.ts` (`putCountryPolicy`, `getCountryPolicy`)
- `scripts/seed-country-policies.mjs` (seed script)
