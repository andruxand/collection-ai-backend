# Policy & Compliance (Colombia-oriented MVP)

> This is NOT legal advice. It's an engineering policy layer designed to reduce compliance risk.

## Goals
- Respect opt-out requests immediately
- Avoid contacting outside allowed hours
- Avoid holidays (optional)
- Avoid channel-switching "pressure" after direct contact (7-day window)
- Enforce cooldowns for outbound reminders/campaigns

## Rules implemented
- `optedOut = true` blocks all outbound on that channel (and can be extended to global)
- Consent checks per channel:
  - WhatsApp: `debtor.consents.whatsapp`
  - Telegram: `debtor.consents.telegram`
- Outbound hours:
  - Mon–Fri, Sat ranges configured in tenant policy
  - Sunday blocked configurable
- Holidays:
  - Uses `date-holidays` for Colombia if enabled
- No-multichannel same week:
  - If user replied on channel A, do not proactively message on channel B for 7 days
- Cooldown:
  - `contact.nextContactAllowedAt` blocks outbound until that time

## Where code lives
- `src/core/policy/policyCheck.ts`
- Tenant defaults: `src/core/store/tenantDefaults.ts` (or similar)

## Extending for production
- Add:
  - per-tenant/per-creditor do-not-contact windows
  - max attempts per time window
  - escalation thresholds and human handoff
