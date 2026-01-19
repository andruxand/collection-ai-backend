# Conversación V2 (Agente Único)

Objetivo: fluidez guiada por el agente con guardrails mínimos; menos plantillas "quemadas" y menor latencia.

## Arquitectura
- Agente único `ConversationAgentV2`: micro-plan desde `intent` (PAY_NOW, PAY_LATER, INFO_REQUEST, OFF_TOPIC/UNKNOWN) → `WriterAgent` → guard de política ligero.
- Plantillas sólo para: `negotiation.pay_now`, `info.how_to_pay`, reengage/final/polite_close. El resto lo frasea el agente.
- Estado: si hay `summaryToConfirm` (monto + fecha [+ método]) → `PROMISE` y se retorna `promise`.

## Slots y validación
- `amountCop`: entero positivo, redondeado.
- `dateIso`: formato YYYY-MM-DD.
- `paymentMethod`: uno de `PSE|CARD|TRANSFER|CASH`.
- Una aclaración por slot; si falta fecha → preguntar fecha; si hay fecha pero falta monto → preguntar monto.

## Flags y límites
- `maxOffTopicRedirects`: reengage → final_warning → polite_close.
- Abuso/Disputa se derivan por `handoffIntent` en el runner.

## Deploy y flags
- `CONV_V2_ENABLED` default `'true'` en Serverless; los tests usan V1 si no se setea.

## Métricas a observar
- Éxito de slots (commit date/amount), intentos por turno, derivaciones (handoff), off-topic redirects.

## Dataset (opcional fine‑tuning)
- Formato JSONL con campos: `text`, `intent`, `entities: {amountCop?, dateIso?, paymentMethod?}`, `plan_action`.
- Split: 70/15/15; medir F1 de intentos y exact-match de slots.

## E2E checklist
1) PAY_NOW: respuesta directa con instrucciones; sin aclaraciones.
2) PAY_LATER con fecha y monto: confirmación, `state: PROMISE`, retorno `promise`.
3) OFF_TOPIC: progresión reengage → final → close.
4) INFO_REQUEST: instrucciones de pago.

