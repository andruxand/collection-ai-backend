# Runbook: Multi-Agent Conversation

## Enable/Disable

- Global env flag:
  - `CONVERSATION_MULTI_AGENT_ENABLED=true|false`
- Per-tenant flag (stored in tenant policy):
  - `policy.conversationPolicy.multiAgentOrchestration.enabled`

Both must be enabled to route traffic through the multi-agent path.

## Operational Checks

- Verify per-turn audit items are being written:
  - Look for items with SK prefix `TURN#` under `TENANT#<tenantId>`.
- Verify message-level audit still works:
  - Items with SK prefix `AUDIT#` should still be present.

## Common Failure Modes

- Schema failures from the LLM:
  - `runStrictJsonAgent()` retries up to `maxRepairAttempts`.
  - If still failing, a safe fallback reply is returned.
- Verifier failures:
  - `ConversationTurnRunner` attempts to repair by re-running Writer with `repairInstructions`.

## Tuning

Per tenant, tune:

- `maxRepairAttempts`
- `budgets.maxOffTopicRedirects`
- `budgets.maxSlotAsksPerSlot`
- `budgets.maxNegotiationRounds`
- `budgets.abuseStrikeLimit`

## Emergency Rollback

- Set `CONVERSATION_MULTI_AGENT_ENABLED=false` to force legacy flow for all tenants.
- Or disable per tenant by setting `policy.conversationPolicy.multiAgentOrchestration.enabled=false`.
