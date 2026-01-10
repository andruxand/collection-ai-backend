# Country policies and multi-country support

## Yes: this is configurable
The tenant config (`configs/tenant-demo.json`) controls:
- contact hours (Mon-Fri/Sat/Sun/holidays)
- contact limits by stage
- cooldowns
- offer ladder / discount rules
- handoff policy
- notification policy
This is tenant-scoped and can vary by **country**.

## What varies by country
Typical deltas:
- allowed contact windows and holidays
- opt-out requirements and wording
- maximum attempts in a time window
- escalation requirements (handoff sooner)
- language/locale (Spanish, Portuguese, etc.)

## Recommended approach
- Keep "policy engine" deterministic.
- Maintain **policy templates per country** (CO/CL/PE/etc).
- Choose template when creating a tenant, then customize.

## Templates
See `configs/policy-templates/`.
