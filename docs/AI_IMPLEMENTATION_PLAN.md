# AI Implementation Plan (Conversation Engine) — Collections AI

> Purpose: This document is the “single source of truth” for AI-assisted development (Copilot/Cursor/Claude) to evolve the current system from a rigid chatbot into an intelligent, goal-driven conversational agent for collections.
>
> Target: MVP production-ready, multi-tenant, multi-country (starting Colombia), channels: WhatsApp + Telegram (+ voice later).

---

## 0) What we are building (high-level)

We are NOT building a generic chatbot.

We are building a **Conversation Engine** that behaves like a skilled human agent:
- Leads the conversation toward **payment**, **promise-to-pay**, or **payment plan**.
- Handles noisy input (typos, slang, partial info).
- Parses natural language dates/amounts with clarification when ambiguous.
- Redirects off-topic conversations back to the goal.
- Applies compliance rules (country + tenant), including channel/time/frequency.
- Terminates gracefully on abuse and records audit/handoff when needed.
- Minimizes hallucinations: **never invent debtor data**, never invent policies.

Core principle: **LLM is not the business brain**.  
LLM supports understanding + language generation, while **strategy, validation, and compliance** are deterministic in code.

---

## 1) Constraints & non-negotiables

### 1.1 Engineering constraints
- TypeScript strict. Avoid `any`. If unavoidable, use `unknown` + type guards.
- Keep existing routes, queueing, and core flow stable.
- Small PRs (each PR should be reviewable and low-risk).
- Unit tests must be added for each new behavior.

### 1.2 Security & compliance constraints
- Do not log sensitive payloads by default. If needed, mask/redact.
- Respect country + tenant policies: allowed channels, time windows, contact frequency, consent requirements, mandatory disclaimers, prohibited content.
- Never make illegal threats or misrepresent legal consequences.
- In production, if tenant routing cannot be resolved, fail safe (do not contact).

### 1.3 Product constraints (MVP)
- No admin UI required yet, but everything must be configurable (tenant + country) via DynamoDB seed + admin endpoints later.
- Prefer deterministic confirmations (quick replies / yes-no) for ambiguous dates/money.

---

## 2) Current problem summary (why we change)

Today’s limitations:
- Rigid date formats → users fail to provide correct format → flow breaks.
- Poor tolerance to typos/slang → “feels worse than a chatbot”.
- No strong steering → offtopic loops.
- No robust escalation/termination behavior (toxic/offensive users).
- LLM may “respond” but doesn’t reliably “advance” toward outcome.

---

## 3) Target architecture (modules & flow)

### 3.1 Pipeline per inbound message (Conversation Engine)
1) **Normalize** (cheap, tolerant)
   - Input: raw user text + minimal context (language, locale, previous turn)
   - Output: normalized text, detected language, hints on misspellings

2) **NLU (structured output)**  
   - Extract:
     - `intent`
     - `entities/slots` (date, amount, preferred day, etc.)
     - `confidence` (per slot + overall)
     - `toxicity`, `offtopic`, `identity/dispute` flags

3) **Compliance check (deterministic + structured constraints)**
   - Evaluate:
     - Allowed contact at this time?
     - Channel allowed?
     - Required disclaimers?
     - Frequency/cooldown constraints?

4) **Planner (goal-based, structured output)**
   - Determine the **turn goal** + next action:
     - ask for missing slot
     - propose offer
     - confirm ambiguous date
     - create promise
     - handoff to human
     - end conversation / cooldown
   - Output includes:
     - `goal`
     - `missingSlots`
     - `needsClarification`
     - `clarifyingQuestion` (if needed)
     - `nextAction` (NBA)

5) **Tool execution (deterministic)**
   - If action requires persistence:
     - create promise / schedule reminder / create handoff / set cooldown / audit

6) **Composer (LLM or templates)**
   - Generate user-facing message using:
     - plan + constraints + known facts
   - Must not invent data.
   - Must include required disclaimers.
   - Must follow tone policy by stage.

---

## 4) Data model additions (conceptual)

### 4.1 Conversation state
- `state` (e.g., COLLECTING_PROMISE_DATE, COLLECTING_PROMISE_AMOUNT, NEGOTIATION, CLOSED)
- `slots`:
  - `promiseDate`
  - `promiseAmount`
  - `paymentMethod` (optional)
  - `disputeReason` (optional)
- `attemptCounters`:
  - consecutiveOfftopicCount
  - consecutiveToxicCount
- `lastUserMessageAt`
- `nextContactAllowedAt` (cooldown)

### 4.2 NLU result (structured)
- `intent`: PAY_NOW | PROMISE_TO_PAY | NEGOTIATE | DISPUTE | WRONG_PERSON | OFFTOPIC | ABUSIVE | UNKNOWN | ...
- `entities`:
  - `dateCandidate` + `dateConfidence` + `dateAmbiguityReason`
  - `amountCandidate` + `amountConfidence`
- `signals`:
  - `toxicityLevel`
  - `offtopicLevel`
  - `needsIdentityVerification`

### 4.3 Planner output (structured)
- `goal`: ASK_DATE | ASK_AMOUNT | CONFIRM_DATE | CONFIRM_AMOUNT | OFFER_PLAN | FINALIZE_PROMISE | HANDOFF | END
- `nextAction` (NBA): CREATE_PROMISE | SHOW_OFFERS | ASK_CLARIFICATION | COOLDOWN | HANDOFF | END_CONVERSATION
- `clarifyingQuestion` (if any)
- `options` (quick replies when possible)

---

## 5) LLM strategy (cost/benefit)

Use two model tiers:
- **Cheap model** for Normalize + NLU classification/extraction
- **Better model** for composing the final message when needed

Key: Keep prompts small, use structured outputs (JSON Schema), and cache static prompt prefix.

LLM should:
- Return structured JSON (NLU/Planner) rather than plain text.
- Compose message using a strict system message:
  - “Use only provided debtor data and plan. Never invent numbers or legal claims.”

---

## 6) Implementation plan (PR by PR)

### PR1 — Foundations: Types + Schemas + Non-breaking wiring
- Create:
  - `src/core/conversation/types.ts`
  - `src/core/conversation/schemas.ts` (Zod or JSON schema definitions)
  - `src/core/conversation/pipeline.ts` (stub pipeline with TODO)
- Add:
  - `normalizeText()` stub (deterministic minimal)
  - `nluExtract()` stub (returns UNKNOWN intent)
  - `planTurn()` stub (asks a clarifying question)
- Tests:
  - pipeline “does not crash” and returns valid structured outputs

### PR2 — Normalization + robust parsing (typos, dates, amounts)
- Implement:
  - `normalizeText()` (cheap model OR deterministic rules + abbreviations)
  - `parseMoneyFlexible()` (2 palos, 200k, 150.000, etc.)
  - `parseDateFlexible()` (mañana, viernes, quincena, 12/01 ambiguity)
  - `ambiguityResolver()` -> generate clarification prompts
- Tests:
  - 30 Spanish CO cases (typos + dates + money)
  - Must produce `needsClarification=true` on ambiguous inputs

### PR3 — NLU structured outputs + confidence + flags
- Implement:
  - NLU returns: intent + entities + confidence + toxicity/offtopic/identity/dispute flags
- Tests:
  - Cases for: wrong person, dispute, abusive, offtopic

### PR4 — Planner: goal-driven + steering behavior
- Implement:
  - turn-goal selection
  - missing slots identification
  - off-topic steering (bridge + redirect)
  - toxic policy (warn then end + audit)
- Tests:
  - Ensure conversation moves toward promise/payment
  - Ensure toxic escalation works

### PR5 — Composer + compliance integration
- Implement:
  - message composer (LLM or templates) with constraints
  - mandatory disclaimers inclusion
  - never hallucinate debtor data (only from context)
- Tests:
  - “composer uses plan” tests (snapshot-like)
  - “disclaimer required” tests

### PR6 — Evals harness (dataset-driven)
- Create:
  - `tests/conversations/cases.es-CO.json`
  - `tests/conversations/e2eConversation.test.ts`
- Enforce:
  - for each case expected NLU + expected plan action

---

## 7) Test dataset guidance (Spanish CO)

Include cases like:
- “pgo mñna”
- “el otro viernes”
- “2 palos”
- “200k”
- “12/01” ambiguity (Jan 12 vs Dec 1)
- “no soy esa persona”
- “me están estafando”
- off-topic: “y el partido qué?”
- toxic: “no joda” / stronger insults
- negotiation: “me baja algo y pago”

Each case should include:
- `inputText`
- minimal debtor context (stage, due amount)
- expected:
  - `intent`
  - extracted slots + confidence
  - `needsClarification`
  - `nextAction`
  - `clarifyingQuestion` (if applicable)

---

## 8) Operational checklist (production readiness)

- Tenant routing:
  - WhatsApp: `phone_number_id -> tenantId` mapping (Dynamo)
  - Telegram: `botKey -> tenantId` mapping (Dynamo)
  - If mapping missing in production: do NOT process inbound (safe fail)
- Secrets:
  - Telegram bot token per tenant in Secrets Manager (later)
  - WhatsApp tokens & app secret protected
- Logging:
  - structured logs with redaction
- Rate limits:
  - per tenant / per debtor (apply in policyCheck)
- Auditing:
  - record attempts, warnings, handoffs, promise creations

---

## 9) How to use this doc with Copilot (best practice)

### 9.1 Workflow
1) Open these files before asking Copilot:
   - this doc (`docs/AI_IMPLEMENTATION_PLAN.md`)
   - orchestrator handler
   - policyCheck
   - nba (nextBestAction)
   - llm client + responseWriter
2) Ask Copilot:
   - “Create PR1 plan + exact files to modify (no code yet)”
3) Then:
   - “Implement PR1, keep changes small, add tests, no any”
4) Repeat per PR.

### 9.2 Copilot constraints to remind every PR
- TS strict, avoid `any`.
- Structured outputs for NLU/Planner.
- Deterministic validation for date/money.
- Never invent debtor data.
- Add tests for each behavior.

---

## 10) Glossary (quick)

- **Inbound**: user initiated message (WhatsApp/Telegram user writes).
- **Outbound**: system initiated contact (scheduled reminders/outreach).
- **Outreach**: one system attempt to contact the debtor.
- **NLU**: intent + entity extraction.
- **Slots**: structured fields we need (date, amount).
- **Planner**: chooses goal + next action.
- **Composer**: writes the final message.
- **NBA**: Next Best Action (strategy decision).
- **Steering**: redirect off-topic back to the goal.
- **Toxicity handling**: warn/end conversation based on abuse.
- **Compliance**: country + tenant policy constraints.

---

## 11) Definition of Done (DoD)

A change is “done” when:
- Typecheck passes (`npm run typecheck`)
- Tests pass (`npm test`)
- No new `any` introduced
- For each new behavior, at least 1 unit test exists
- Docs updated if user-facing or operational changes exist
