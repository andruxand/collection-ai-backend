# Prompting Guidelines (Multi-Agent)

These guidelines are applied in the prompts for Classifier/Planner/Writer/Verifier agents.

## General

- Output must be JSON-only (no prose, no markdown).
- Do not hallucinate amounts, dates, or debtor-specific details.
- Keep responses short and actionable.

## Classifier

- Choose a single primary intent.
- Extract entities only when explicitly present.
- Use `flags` to signal ambiguity or escalation needs.
- Always output `mode`, `modeConfidence` (0..1), and a short `modeRationale` (for audit).

### Mode quick mapping

- `NEGOTIATION`: default collections negotiation.
- `DISPUTE`: user disputes the debt/amount/identity; be neutral and verification-first.
- `WRONG_PERSON`: user indicates wrong number/person; do not expose debt details.
- `ABUSE_DEESCALATION`: user is abusive; set boundaries and de-escalate; end after strike limit.
- `HUMAN_HANDOFF`: explicit request or high-risk scenario; prepare for escalation.

## Planner

- Use budgets to avoid endless loops.
- Prefer one clear question when missing required slots.
- Escalate disputes/abuse when handoff is enabled and budgets allow.
- Planner prompts are composed as base + mode addendum; the mode addendum defines priority constraints.

### Deterministic templates (tool arbitration)

The planner may choose `INFORM_TEMPLATE` for short, deterministic responses (to reduce latency/cost).

Do NOT use templates when:
- Classifier flags show ambiguity/contradiction (`ambiguousAmount`, `ambiguousDate`, `contradiction`).
- The conversation is already in deeper negotiation (`negotiationRounds >= 2`).
- The user provides new debtor-specific facts that require custom handling.
- The response needs nuance (dispute investigation steps, empathy-heavy situations, complex policy explanation).

Prefer templates when:
- `WRONG_PERSON`: safe exit and confirmation without debt details.
- `ABUSE_DEESCALATION`: boundary warning + simple next step.
- Simple `INFO_REQUEST`: how-to-pay / support hours.

## Writer

- Mirror the plan exactly:
  - `ASK_SLOT` → one clear question
  - `REDIRECT` → tactfully bring back to payment topic
  - `ESCALATE` → explain next steps and request minimal info
  - `END` → close politely
- Avoid threats, shaming, or legal intimidation.
- Respect mode constraints:
  - `WRONG_PERSON`: short, respectful, and never include debt amount/saldo/mora.
  - `DISPUTE`: neutral tone; ask minimal verification.
  - `ABUSE_DEESCALATION`: set boundaries; do not argue.
  - `HUMAN_HANDOFF`: explain next steps clearly.

## Verifier

- FAIL if the writer:
  - Invents facts
  - Violates policy
  - Does not follow the plan
- When FAIL, provide concrete repair steps.
- For `WRONG_PERSON`, FAIL if any debt details appear (amount/saldo/mora/etc.).
