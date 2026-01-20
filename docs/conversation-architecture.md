# Conversation Architecture (Legacy Multi-Agent)

Note: The production runner uses the simplified V2 path (Classifier → Writer + lightweight guard) by default. The multi-agent orchestration (Classifier → Planner → Writer → Verifier → RepairLoop) is kept as a legacy/research path and can be enabled only for canary/testing scenarios.

## Goals

- LLM-first decisions for classification and planning.
- Deterministic code only for: budgets/guardrails, compliance hard-stops, and persistence/audit.
- Strict JSON-only agent outputs validated by JSON Schema + Zod.
- Automatic repair on schema failures and on verifier failures.

## Components

- `src/core/conversation/ClassifierAgent.ts`
  - Produces intent + entities + flags + confidence.
  - Also produces `mode` (conversation mode) with `modeConfidence` + `modeRationale` for auditability.
- `src/core/conversation/PlannerAgent.ts`
  - Chooses action type (ask slot / confirm / redirect / escalate / end / inform) and state transitions.
  - Applies deterministic mode constraints (e.g., `HUMAN_HANDOFF` forces `ESCALATE`, `WRONG_PERSON` forces identity verification).
- `src/core/conversation/WriterAgent.ts`
  - Generates the actual user-facing message.
- `src/core/conversation/VerifierAgent.ts`
  - Validates compliance and plan adherence; when FAIL, emits repair instructions.
  - Includes deterministic hard-stops for some modes (e.g., `WRONG_PERSON` must not include debt details).
- `src/core/conversation/strictJsonAgentRunner.ts`
  - Calls `llmJson()` with strict JSON schema, validates output with Zod, and retries with a repair prompt.
- `src/core/conversation/ConversationTurnRunner.ts`
  - Orchestrates the chain, applies budgets, persists per-turn audit.

## Conversation Modes

The system routes behavior using a `mode` enum selected by the classifier:

- `NEGOTIATION` (default)
- `DISPUTE`
- `WRONG_PERSON`
- `ABUSE_DEESCALATION`
- `HUMAN_HANDOFF`

Mode is used as a lightweight routing signal:

- Planner/Writer/Verifier prompts include a per-mode addendum.
- Deterministic guardrails enforce key constraints even if the LLM drifts.

## Prompt Composition (Base + Mode Addendum)

To avoid duplicating full prompts, each agent prompt is composed from:

- a base prompt (e.g. `planner.prompt.md`)
- plus a mode addendum (e.g. `planner.mode.wrong_person.md`)

Composition is done in `src/conversation/infra/promptLoader.ts` via `loadPromptComposed()`.

## Data Persistence

- Conversation state is stored on the existing `CONV#<channel>#<debtorId>` item.
  - Multi-agent state is stored in `conversation.multiAgent`.
  - Mode routing state is persisted in `conversation.multiAgent.workingMemory.state`:
    - `mode`
    - `modeConfidence`
    - `modeRationale`
    - `modeUpdatedAtTurnCount`
- Per-turn agent IO is persisted via a dedicated item written by `putConversationTurnAudit()`.
  - SK format: `TURN#<atIso>#<turnId>#<messageId>`.
  - Payload respects tenant audit policy:
    - `auditPolicy.storeMessageText` controls whether recent turn text is persisted.
    - `auditPolicy.storeDecisionPayloads` controls whether agent payloads and raw histories are stored.

## Feature Flag

Multi-agent orchestration is enabled only when:

- `CONVERSATION_MULTI_AGENT_ENABLED=true` (environment)
- `tenant.policy.conversationPolicy.multiAgentOrchestration.enabled=true` (per tenant)

When disabled, the legacy NLU/NBA flow remains unchanged.
