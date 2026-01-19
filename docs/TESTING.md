# Backend Testing

This backend uses **Vitest** for fast, TS-friendly unit tests.

## Test placement (best practice)
- All tests live under `tests/**` (no `*.test.ts` inside `src/**`).
- Recommended folders:
	- `tests/unit/**` for unit tests
	- `tests/integration/**` for integration tests (optional)
	- `tests/conversation/**` for dataset/eval-style tests (optional)

Vitest is configured to run `tests/**/*.test.ts`.
In tests, prefer importing code via the `@` alias (maps to `src`) instead of relative paths.

## Run
```bash
npm test
```

## Lint
```bash
npm run lint
npm run lint:fix
```

## Typecheck
```bash
npm run typecheck
```

## Included tests (MVP)
- `tests/unit/core/policy/policyCheck.test.ts` — outbound hours & stage limits
- `tests/unit/core/policy/effectivePolicy.test.ts` — effective policy intersections
- `tests/unit/core/auth/apiKey.test.ts` — generate/parse/hash/match API keys
- `tests/unit/core/offers/offerEngine.test.ts` — discount ladder & hard caps
- `tests/unit/core/nba/nextBestAction.test.ts` — SYSTEM_TICK -> PROACTIVE_OUTREACH
- `tests/unit/core/handoff/handoff.test.ts` — DISPUTE/ANGRY handoff triggers
- `tests/unit/conversation/application/contextSelection.test.ts` — lastTurns selection + summarize cadence
- `tests/unit/conversation/infra/promptLoader.test.ts` — prompts loaded from files
- `tests/unit/conversation/infra/pii.test.ts` — PII masking/redaction

## Notes
- Keep tests deterministic (use fixed dates in UTC, and tenant timezone in policy).
- Prefer `unknown` + narrowing over `any` in handlers and core.
