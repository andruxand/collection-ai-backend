# Debtor Conversation Flows (MVP)

This document describes the debtor-facing automated conversation behavior (WhatsApp/Telegram), focusing on determinism + naturalness.

## Key ideas
- **Deterministic decisions**: Policy + Offer Engine + NBA decide what happens.
- **LLM usage**: NLU classification/extraction, plus optional rewrite of short drafts.
- **State-aware NLU**: The current conversation state is provided to NLU to reduce loops.

## Enrollment (identity binding) and channels

To keep collections compliant and avoid disclosing debt to third parties, the system should only discuss debt when the inbound message comes from a channel that is **already bound** to a known debtor.

In this backend, a debtor is considered **enrolled** when the tenant has loaded the debtor (bulk or 1–1) and the record includes at least one channel identifier:
- `phoneE164` (WhatsApp, E.164 like `+573001112233`) and/or
- `telegramUserId` (Telegram).

When debtors are loaded via `upsertDebtors`, lookup records are created (`LOOKUP#PHONE#...` and `LOOKUP#TG#...`) so inbound channel identity can be resolved to the correct `debtorId`.

### WhatsApp
- Identity: the sender phone number (E.164).
- Recommended operational rule: only start outreach if `phoneE164` is present and `consents.whatsapp=true`.

### Telegram
- Identity: `telegramUserId`.
- Operational note: tenants often do not know `telegramUserId` ahead of time; a linking step is needed (e.g., bot shows the ID, or a one-time enrollment code flow).

### If the user is NOT enrolled
- Inbound messages from unknown phone/telegram ids must not enter the debt conversation.
- The system should reply with instructions on how to register/bind the channel (and avoid revealing balance/amounts).

## Case closure (tenant/operator)

Some edge cases require the tenant to close a debtor case (e.g., payment confirmed, wrong person, fraud, portfolio moved, agreement finished). When the case is closed:
- Proactive outreach (scheduled outbound tick) is blocked by policy.
- If the debtor writes (inbound), the system replies with a short “case closed” message and how to request reopening.

## NLU intents used in the flow (non-exhaustive)
- `GREETING`: greetings and `/start`
- `ASK_DETAIL`: ask for balance / details
- `NEGOTIATE`: ask for an agreement (discount / installments)
- `PAY_NOW`: wants to pay today / payment link
- `PROMISE_PAYMENT`: provides a date and/or amount to pay later
- `SELECT_OFFER`: selecting an offer when state is `OFFER_MENU` (uses `entities.offerIndex`)
- `ALREADY_PAID`: indicates payment already made
- `DISPUTE`: disputes debt / identity / fraud
- `ANGRY`: anger/escalation
- `OPT_OUT`: requests to stop contact
- `OFFTOPIC` / `UNKNOWN`: does not match the cobranzas context

## Main inbound flow
```mermaid
sequenceDiagram
  autonumber
  participant D as Debtor
  participant CH as Channel (WA/TG)
  participant ORCH as Orchestrator
  participant MA as Multi-Agent Orchestration
  participant DM as Dialogue Manager (optional)
  participant NLU as NLU (LLM + deterministic)
  participant HF as Handoff Router
  participant OFF as Offer Engine
  participant NBA as Next Best Action
  participant W as Response Writer

  D->>CH: Send message
  CH->>ORCH: NormalizedInboundEvent (SQS)
  Note over ORCH: V2-only runner (Classifier→Writer + guard)
  ORCH->>V2: runTurn(Classifier→Writer + guard)
  V2-->>ORCH: replyText + nextConversation (+ optional handoffIntent/promise)
  ORCH-->>CH: Send reply
  Note over ORCH: If DIALOGUE_MANAGER_ENABLED=true, try DM
  alt Dialogue Manager enabled and valid
    ORCH->>DM: decide(nlu+nba) with strict JSON schema
  else DM disabled or invalid
    ORCH->>NLU: parseIntent(text, conversationState)
  end
  ORCH->>HF: maybeHandoff(tenantPolicy, stage, intent)
  alt no handoff
    ORCH->>OFF: buildOffers(tenantPolicy, debtor, conversation)
    Note over ORCH: NBA + Writer can come from DM or deterministic engine
    ORCH->>NBA: nextBestAction(...) OR dm.nba
    ORCH->>W: writeResponse(...) OR dm.messageDraft
    ORCH-->>CH: Send reply
  else handoff
    ORCH-->>CH: Acknowledge + request verification details
  end
  end
```

## Offer selection (in `OFFER_MENU`)
```mermaid
sequenceDiagram
  autonumber
  participant D as Debtor
  participant ORCH as Orchestrator
  participant NLU as NLU
  participant NBA as Next Best Action

  Note over ORCH: conversation.state = OFFER_MENU
  D->>ORCH: "1" (or "2")
  ORCH->>NLU: parseIntent(text, state=OFFER_MENU)
  NLU-->>ORCH: intent=SELECT_OFFER, entities.offerIndex
  ORCH->>NBA: nextBestAction(..., offers)
  NBA-->>ORCH: SEND_PAYMENT_LINK (one-pay) OR ASK_SLOT(promiseDate) (installments MVP)
```

## Ops toggles
- `LLM_REWRITE_ENABLED=false`: disables the optional rewrite step and uses deterministic templates only.
- `DIALOGUE_MANAGER_ENABLED=true`: enables the Dialogue Manager path (falls back safely if invalid).

Multi-agent toggles:
- `CONVERSATION_MULTI_AGENT_ENABLED=true`: enables the multi-agent pipeline (requires tenant policy + LLM provider configured).
- `CONVERSATION_CONTEXT_PACK_V1_ENABLED=true`: enables ContextPack/v1 assembly for agents (requires tenant policy).

## Future upgrade (agent framework)
If we later adopt an agent framework (e.g. Voltagent-style), the recommended evolution is:
- Keep this repository's **policy / offer engine / audit / safety** as deterministic governors.
- Move DM into an agent runtime that plans tool calls, but still outputs **strict JSON** decisions.
- Treat `strategyPolicy` as the source of truth for objective/constraints per tenant.

For a more concrete migration path and tool catalog, see `docs/04-llm.md` (section: "Future upgrade: agent runtime (Voltagent-style)").

## Where in code
- NLU: `src/core/nlu/parseIntent.ts`
- NBA: `src/core/nba/nextBestAction.ts`
- Writer: `src/core/llm/responseWriter.ts`
- Orchestrator: `src/handlers/orchestrator.ts`
- Handoff: `src/core/handoff/handoff.ts`
