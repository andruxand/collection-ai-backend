# Architecture

## High-level flow
```mermaid
flowchart TD
  WA[WhatsApp Webhook] --> N[Normalize Inbound]
  TG[Telegram Webhook] --> N
  N --> Q[SQS FIFO Inbound Queue]
  Q --> ORCH[Orchestrator Lambda]

  ORCH --> P[Policy Engine]
  ORCH --> D[(DynamoDB Single Table)]
  ORCH --> LLM[NLU (LLM Structured Outputs)]
  ORCH --> NBA[Next Best Action]
  ORCH --> OFF[Offer Engine]
  ORCH --> RW[Response Writer + Safety Filter]
  RW --> SND[Channel Sender]
  SND --> WA2[WhatsApp Cloud API]
  SND --> TG2[Telegram API]

  ORCH --> AUD[Audit Logger]
  AUD --> D

  ORCH --> REM[Create Reminder]
  REM --> D

  TICK[Scheduled Reminders Tick] --> D
  D --> TICK
  TICK --> P2[Policy Engine (Outbound)]
  P2 --> SND2[Channel Sender]
  SND2 --> WA2
  SND2 --> TG2
  TICK --> AUD

  OUTTICK[Scheduled Outbound Tick] --> D
  D --> OUTTICK
  OUTTICK --> P3[Policy Engine (Outbound)]
  OUTTICK --> NBA2[Next Best Action (SYSTEM_TICK)]
  NBA2 --> SND3[Channel Sender]
  SND3 --> WA2
  SND3 --> TG2
  OUTTICK --> AUD
```

## Conversational Path (V2 por defecto)
- Classifier (Structured Outputs) → `ConversationAgentV2` micro‑plan
- `WriterAgent` (una pasada, sin A/B rerank)
- Guard de política ligero (deterministic)
- Sender (Telegram/WhatsApp)
- Audit en DynamoDB

Toggles:
- `CONVERSATION_MULTI_AGENT_ENABLED`: habilita el camino multi‑agente legado (sólo canary/investigación)

## Why SQS FIFO?
- Guarantees ordering per debtor and avoids concurrent state races
- Allows Lambda retries while keeping idempotency safe

## Multi-tenancy
- Every record is partitioned by `TENANT#<tenantId>`
- Tenants are registered under `pk = TENANTS` (used by scheduled jobs)
- WhatsApp/Telegram identifiers resolve to a stable `debtorId`

See data model details in `docs/02-data-model.md`.
