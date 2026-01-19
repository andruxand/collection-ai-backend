# LLM Usage (Cost/Benefit and Safety)

## MVP choice: OpenAI `gpt-4o-mini`
We use an LLM for:
1) **NLU**: intent + entities via **Structured Outputs (JSON Schema)**  
2) Optional **copy polishing**: turning deterministic decisions into natural language

This keeps the system deterministic and auditable while still conversational.

## Current Default: ConversationAgentV2
The backend now defaults to the simplified V2 conversational path focused on micro-planning + a single Writer pass with lightweight guards. See the detailed architecture in [collections-ai-backend/docs/AI_V2.md](collections-ai-backend/docs/AI_V2.md).

- Env flag: `CONV_V2_ENABLED` controls the V2 path. Deploy environments default to `true`; unit tests keep V1 unless explicitly set to `true`.
- Deterministic governors (policy, offer engine, safety filter) remain in effect.
- Minimal templates are used only for predictable cases (e.g., `PAY_NOW`, info requests, off-topic close).

## Important design principles
- The LLM **does not** decide:
  - whether to contact (policy does)
  - the discount/offer (offer engine does)
  - the compliance decisions (policy does)
- The LLM is used for classification and wording only (unless Dialogue Manager is enabled).

## Dialogue Manager (LLM-first, governed)
The system supports an optional **Dialogue Manager (DM)** that can decide both:
- `nlu` (intent + entities)
- `nba` (next best action + nextState + slotsUpdate)

This is designed to reduce the growth of rule-based intents while keeping **guardrails**:
- Policy, offer engine, and safety filter remain deterministic gates.
- Output is constrained to a strict JSON schema.

Operational control:
- `DIALOGUE_MANAGER_ENABLED=true` enables the DM path.
- If the DM fails validation or errors, the system falls back to the existing `parseIntent` + `nextBestAction` flow.

Strategy control (per tenant):
- `tenant.policy.strategyPolicy` can set the objective (collect now vs negotiate vs nudge, etc.) and tone rules based on `daysPastDue`/`totalDueCop`.

## Legacy (V1) Multi-Agent Orchestration (Classifier → Planner → Writer → Verifier)
Note: As of V2, this path is disabled by default. Use it only for canary or research scenarios. See [collections-ai-backend/docs/AI_V2.md](collections-ai-backend/docs/AI_V2.md) for the recommended default path.

In addition to the DM, the backend includes a **multi-agent workflow** designed for more human-like, context-aware conversations while preserving governance:

- **ClassifierAgent**: classifies the conversation mode (NEGOTIATION / DISPUTE / WRONG_PERSON / etc.) and detects ambiguity.
- **PlannerAgent**: chooses a constrained action (offer options, ask slot, confirm, template, etc.) under strict JSON schema.
- **WriterAgent**: drafts the message for the chosen action.
- **VerifierAgent**: validates compliance/safety and triggers repair when needed.

Important: this workflow is feature-flagged and may be **disabled in a given environment/tenant**.

### When it runs
The multi-agent path runs only when ALL of these are true:
- Environment: `CONVERSATION_MULTI_AGENT_ENABLED=true`
- Tenant policy: `tenant.policy.conversationPolicy.multiAgentOrchestration.enabled=true`
- LLM provider configured: `LLM_PROVIDER_JSON` exists and `provider != "mock"`

Optional (recommended) context pipeline:
- Environment: `CONVERSATION_CONTEXT_PACK_V1_ENABLED=true`
- Tenant policy: `tenant.policy.conversationPolicy.contextPackV1.enabled=true`

If any condition is not met, the orchestrator falls back to the deterministic/DM path.

In V2-default environments, the system takes the V2 path first when `CONV_V2_ENABLED=true`, bypassing the multi-agent orchestration.

### Why we still have regex/if-else at all
Regex/if-else are intentionally kept **only** for:
- Safety/compliance-critical, immediate behaviors (e.g. opt-out)
- Fast deterministic shortcuts (e.g. menu numbers)
- Fallback when the LLM is unavailable/misconfigured

They are NOT the scalable primary approach for natural language understanding. The scalable path is:
- LLM structured outputs (NLU/Planner), plus
- deterministic governors (policy / offer engine / safety filter), plus
- audit + budgets to prevent loops.

## NLU (state-aware)
NLU receives the **current conversation state** (e.g. `WELCOME`, `OFFER_MENU`, `DETAIL`, `PAYMENT`) to improve accuracy and reduce menu loops.

We also keep a deterministic layer for common patterns (fast + predictable):
- Greetings (`/start`, `hola`, etc.) → `GREETING`
- Main menu numbers (`1..4`) → `ASK_DETAIL`, `NEGOTIATE`, `PAY_NOW`, `PROMISE_PAYMENT`
- Offer selection when in `OFFER_MENU` (e.g. `1`, `2`) → `SELECT_OFFER` with `entities.offerIndex`
- Short confirmations (e.g. `sí`, `ok`) → `AFFIRM`; (e.g. `no`) → `DENY` (handled state-aware in NBA to avoid loops)

The structured NLU schema includes (non-exhaustive):
- `intent`: `GREETING | AFFIRM | DENY | SELECT_OFFER | PAY_NOW | NEGOTIATE | PROMISE_PAYMENT | ASK_DETAIL | DISPUTE | ALREADY_PAID | OPT_OUT | ANGRY | OFFTOPIC | UNKNOWN`
- `entities`: `amountCop`, `dateIso` (YYYY-MM-DD), `paymentMethod`, `offerIndex`

## Copy polishing (optional, guarded)
The response is always based on a deterministic NBA decision + templates.
An optional LLM rewrite step can make the wording more natural **without changing meaning**.

Operational control:
- Set `LLM_REWRITE_ENABLED=false` to fully disable rewrite (useful for debugging and strict deterministic environments).

Guardrails:
- Rewrite is skipped when the draft contains URLs or numbered menus (to preserve exact options/order).
- Prompts instruct the model to preserve amounts, dates and URLs.

## Files
- `src/core/llm/llmClient.ts` — OpenAI Responses API client
- `src/core/nlu/parseIntent.ts` — NLU uses JSON schema, fallback regex
- `src/core/llm/prompts.ts` — prompt templates
- `src/core/llm/safetyFilter.ts` — final guardrails
- `src/core/dialogue/*` — Dialogue Manager (prompt + schema + runner)
- `src/core/conversation/ConversationAgentV2.ts` — V2 micro-plan + single Writer pass with lightweight guard
- `src/core/conversation/tools/slots.ts` — slot validators for `amountCop`, `dateIso`, `paymentMethod`

## Prompting guidance
- Use **strict JSON schema** for NLU
- Use low temperature (0–0.2)
- Include minimal sensitive info; prefer IDs + summarized balances

## Future upgrade: agent runtime (Voltagent-style)
The current **Dialogue Manager (DM)** is a good stepping stone to a true agentic system.
The goal of a Voltagent-style upgrade is to make the system feel more conversational while keeping it:
- governed (finite actions + tool whitelist)
- auditable (full trace)
- safe (policy + safety filter remain deterministic)

### What changes (conceptually)
- Today: the DM returns `{ nlu, nba, messageDraft? }` directly.
- Voltagent-style: an **agent** plans and calls tools (deterministic functions) and then returns a final structured decision.

The key is that the agent is **not** allowed to free-form decide anything outside a fixed tool/action catalog.

### Recommended tool catalog (minimal)
Keep tools deterministic and idempotent where possible:
- `getConversationContext(tenantId, debtorId, channel)`
- `getDebtorSnapshot(tenantId, debtorId)`
- `policyCheck(now, tenantPolicy, debtor, contact, channel, direction)`
- `buildOffers(tenantPolicy, debtor, conversation)`
- `nextBestAction(tenantPolicy, debtor, conversation, nlu, offers)` (or keep as fallback)
- (Future) `createPaymentLink(tenantId, debtorId, selectedOfferId?)` (returns URL)
- `createPromise(tenantId, debtorId, dateIso, amountCop)`
- `scheduleReminder(tenantId, debtorId, dueAtIso, payload)`
- `openHandoffCase(...)`

These map cleanly to existing modules in `src/core/*`.

### Agent loop (recommended)
1) Build a compact context (tenant strategy, conversation state, debtor summary, offers summary).
2) Agent produces a plan: which tool to call next and why.
3) Execute tool call(s) deterministically.
4) Agent returns a final strict JSON decision compatible with our runtime:
  - `nlu`: intent/entities
  - `nba`: action/nextState/slotsUpdate
  - optional `messageDraft`

### Governance / guardrails (non-negotiable)
- Tool whitelist only (no arbitrary HTTP/network from the model).
- Per-step budget limits (max tool calls per inbound).
- Keep `policyCheck` and `safetyFilter` as deterministic gates.
- Keep `strategyPolicy` / `objectivePlaybook` as the per-tenant “north star”.
- Add post-processing constraints (like playbook enforcement) for loop prevention.

### Observability
To debug and comply, store an **agent trace** in audit:
- prompt/context summary
- plan steps
- tool calls + outputs (redacted)
- final decision

Today we already store `dm` optionally in audit; a Voltagent-style upgrade should extend that payload (or add a sibling field) with the agent trace.

### Migration path (incremental, safe)
1) Keep current DM schema but allow it to output a simple `plan` field (validated) for internal debugging.
2) (Future) Introduce a single tool call (e.g. `createPaymentLink`) under a feature flag.
3) Gradually expand to multi-step tool planning.
4) Add offline evals: replay real conversations and measure resolution rate, opt-out rate, disputes, and time-to-close.
