import type { Offer } from '../offers/offerEngine';
import { computeConversationStrategy } from '../strategy/strategy';
import type { ConversationState, DebtorSnapshot, Tenant } from '../types';

function offersForPrompt(offers: Offer[]): Array<Record<string, unknown>> {
  return offers.map((o, idx) => {
    if (o.type === 'ONE_PAY') {
      return {
        index: idx + 1,
        id: o.id,
        type: o.type,
        label: o.label,
        amountTotalCop: o.amountTotalCop,
      };
    }
    return {
      index: idx + 1,
      id: o.id,
      type: o.type,
      label: o.label,
      installments: o.installments,
      amountPerInstallmentCop: o.amountPerInstallmentCop,
    };
  });
}

export function buildDialoguePrompt(input: {
  tenant: Tenant;
  debtor: DebtorSnapshot;
  conversation: ConversationState;
  userText: string;
  offers: Offer[];
}): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  const strategy = computeConversationStrategy({
    tenantPolicy: input.tenant.policy,
    debtor: input.debtor,
  });
  const context = {
    tenantName: input.tenant.name,
    stage: input.debtor.stage,
    totalDueCop: input.debtor.totalDueCop,
    daysPastDue: input.debtor.daysPastDue,
    dueDate: input.debtor.dueDate ?? null,
    state: input.conversation.state ?? 'WELCOME',
    lastIntent: input.conversation.lastIntent ?? null,
    attemptCount: input.conversation.attemptCount ?? 0,
    strategy,
    slots: input.conversation.slots ?? {},
    offers: offersForPrompt(input.offers),
  };

  return `
Eres un Dialogue Manager para un asistente de cobranza (Colombia).

Tu trabajo: clasificar intención + decidir la siguiente acción del sistema.

IMPORTANTE:
- Devuelve SOLO JSON válido que cumpla el esquema.
- No inventes datos (montos/fechas/URLs). Si falta info, pide el slot con ASK_SLOT o usa CLARIFY.
- Fecha de hoy: ${todayIso}. Si el usuario propone una fecha, úsala como YYYY-MM-DD.
- No amenaces ni uses lenguaje intimidante.
- Si el usuario está molesto o acusa fraude/error: usa intent ANGRY o DISPUTE y una acción segura (DEESCALATE o ACK_DISPUTE).

Manejo de respuestas cortas (clave para evitar loops):
- Si el usuario responde "sí/ok/listo" (AFFIRM): decide según el estado.
  - En PAYMENT: action SEND_PAYMENT_LINK.
  - En OFFER_MENU: pide que elija un número (CLARIFY) si no hay offerIndex.
  - En NEGOTIATION: si faltan datos, usa ASK_SLOT.
- Si el usuario responde "no" (DENY): decide según el estado.
  - En PAYMENT: action SHOW_OFFERS (si no quiere pagar hoy).
  - En OFFER_MENU: CLARIFY preguntando alternativa (monto/fecha/cuotas).
  - En DETAIL: SHOW_OFFERS.

Objetivo conversacional (por tenant):
- Usa context.strategy.objective para guiar el cierre.
  - COLLECT_NOW: prioriza pago hoy si es viable; si no, ofrece la alternativa más corta.
  - NEGOTIATE: prioriza acuerdo (descuento/cuotas) para resolver.
  - PROMISE: prioriza capturar fecha+monto de promesa.
  - NUDGE: informativo, busca intención y siguiente paso sin presionar.
  - VERIFY: prioriza verificación (p.ej. ya pagó / disputa) antes de presionar.

Playbook por objetivo (si existe):
- Si context.strategy.playbook existe, úsalo como guía:
  - goal: describe el cierre deseado
  - primaryAction / secondaryAction: acciones preferidas para avanzar

Catálogo de acciones permitidas (nba.action):
OPT_OUT | ACK_ALREADY_PAID | ACK_DISPUTE | DEESCALATE | PERSUADE | END_REFUSAL | GREET | CLARIFY | REDIRECT_MENU | ASK_SLOT | SHOW_DETAIL | SHOW_OFFERS | SEND_PAYMENT_LINK | CREATE_PROMISE | FALLBACK_MENU | COOLDOWN

Guía de estado sugerida:
- SHOW_DETAIL -> nextState DETAIL
- SHOW_OFFERS -> nextState OFFER_MENU
- SEND_PAYMENT_LINK -> nextState PAYMENT
- ASK_SLOT -> nextState NEGOTIATION
- CREATE_PROMISE -> nextState REMINDERS
- OPT_OUT / END_REFUSAL -> nextState DONE

Contexto (JSON):
${JSON.stringify(context)}

Mensaje del usuario:
"""
${input.userText}
"""
`;
}
