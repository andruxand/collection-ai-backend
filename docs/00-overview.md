# Collections AI MVP — Overview

## AI Quick Start (Copilot/Cursor/Claude)

This repo builds a multi-tenant, multi-country collections platform (WhatsApp/Telegram).  
Goal: an intelligent **goal-driven conversational agent**, NOT a rigid chatbot.

Non-negotiables:
- TypeScript strict, avoid `any` (use `unknown` + type guards).
- Use structured outputs (JSON schema/Zod) for NLU/Planner.
- LLM does NOT decide business logic: strategy (NBA), compliance, validation are deterministic.
- Must handle typos/slang, natural dates/money with clarification on ambiguity.
- Must steer off-topic, end on abuse (with audit), and respect country+tenant policies.

Start here (in order):
1) `docs/AI_IMPLEMENTATION_PLAN.md`
2) `docs/AI_V2.md` (arquitectura de conversación V2, por defecto)
2) `src/handlers/orchestrator.ts`
3) `src/core/policy/policyCheck.ts`
4) `src/core/nba/nextBestAction.ts`
5) `src/core/llm/*`

DoD:
- `npm run typecheck` + `npm test` pass
- no new `any`
- tests added for new behavior

## Start here (non-redundant)
- `docs/30-frontend-guide.md` (screens/components/routes for Admin + Client Portal)
- `docs/31-api-contracts.md` (frontend API contracts)
- `docs/32-ux-flows.md` (Mermaid UX flows)
- `docs/20-demo-accounts.md` (seed demo users/keys)

## Backend reference
- `docs/AI_V2.md` (flujo conversacional V2, flag `CONV_V2_ENABLED`)
- `docs/14-auth-model.md`
- `docs/07-tenant-config.md`
- `docs/18-country-policy.md`
- `docs/09-handoff.md`
- `docs/11-email-notifications.md`
- `docs/15-platform-users.md`
- `docs/16-client-api-keys.md`
- `docs/19-audit.md`
- `docs/99-glossary.md`


## Additional docs
- `14-country-policies.md` - How country baseline policies are stored in DynamoDB and merged at runtime.

## Channel setup
- WhatsApp Cloud API: `24-whatsapp-cloud-setup.md`
- Telegram: `25-telegram-setup.md`
- E2E testing: `26-integration-e2e-testing.md`

