# Conversación V2 (Agente Único)

Objetivo: fluidez guiada por el agente con guardrails mínimos; menos plantillas fijas y menor latencia.

## Estado actual
- V2 es la única ruta en `ConversationTurnRunner` (no hay toggles ni bifurcaciones V1).
- Sin A/B rerank ni bucle de reparación del Writer/Verifier en el runner.
- `ContextPack V1` es opcional: aporta vista determinística para `classifier`/`writer` y memoria/sumarios.

## Arquitectura
- Agente único `ConversationAgentV2`: micro‑plan desde `intent` (PAY_NOW, PAY_LATER, INFO_REQUEST, OFF_TOPIC/UNKNOWN) → `WriterAgent` → guard de política ligero.
- Plantillas se usan en: `negotiation.pay_now`, `info.how_to_pay`, `negotiation.reengage`, `negotiation.final_warning`, `negotiation.polite_close`. El resto lo frasea el agente.
- Estado: si hay `summaryToConfirm` (monto + fecha [+ método]) → `PROMISE` y se retorna `promise`.

## Slots y validación
- `amountCop`: entero positivo, redondeado.
- `dateIso`: formato YYYY‑MM‑DD.
- `paymentMethod`: uno de `PSE|CARD|TRANSFER|CASH`.
- Una aclaración por slot; si falta fecha → preguntar fecha; si hay fecha pero falta monto → preguntar monto.

## Límites y contadores
- `maxOffTopicRedirects`: reengage → final_warning → polite_close.
- Contadores en presupuestos: `offTopicRedirects`, `abuseStrikes`, `negotiationRounds`, `slotAsks`.
- `handoffIntent`: se deriva de `classifier.intent` (DISPUTE → `DISPUTE`, ABUSIVE → `ANGRY`).

## Observabilidad
- Auditoría por turno con `classifier`, `plan` (cuando aplica), `writer`, `budgets` y `offersCount`.
- Métricas/Logs: `classifier.low_context`, `classifier.missing_date_for_pay_later`, `v2.offtopic_redirect`, `v2.promise_ready`.

## Testing (unitario)
- Mockear `llmJson` por `name`: `classifier` y `writer` (no se usan `planner/evaluator/verifier` en V2 del runner).
- Usar alias `@` apuntando a `src`.
- Ejemplos: `PAY_LATER` sin fecha → pregunta fecha; con fecha y monto → confirma y `state: PROMISE`.

## Dataset (opcional fine‑tuning)
- Formato JSONL con campos: `text`, `intent`, `entities: {amountCop?, dateIso?, paymentMethod?}`, `plan_action`.
- Split: 70/15/15; medir F1 de intentos y exact‑match de slots.

## E2E checklist
1) PAY_NOW: respuesta directa con instrucciones; sin aclaraciones.
2) PAY_LATER con fecha y monto: confirmación, `state: PROMISE`, retorno `promise`.
3) OFF_TOPIC: progresión reengage → final → close.
4) INFO_REQUEST: instrucciones de pago.

