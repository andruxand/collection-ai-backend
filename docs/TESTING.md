# Backend Testing

This backend uses **Vitest** for fast, TS-friendly unit tests.

## Run
```bash
npm test
```

## Typecheck
```bash
npm run typecheck
```

## Included tests (MVP)
- `src/core/policy/policyCheck.test.ts` — outbound hours & stage limits
- `src/core/auth/apiKey.test.ts` — generate/parse/hash/match API keys
- `src/core/offers/offerEngine.test.ts` — discount ladder & hard caps
- `src/core/nba/nextBestAction.test.ts` — SYSTEM_TICK -> PROACTIVE_OUTREACH
- `src/core/handoff/handoff.test.ts` — DISPUTE/ANGRY handoff triggers

## Notes
- Keep tests deterministic (use fixed dates in UTC, and tenant timezone in policy).
- Prefer `unknown` + narrowing over `any` in handlers and core.


### Country policy / Effective policy
- `src/core/policy/effectivePolicy.test.ts`
