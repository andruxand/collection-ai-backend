import { Offer } from '../offers/offerEngine';
import { computeConversationStrategy } from '../strategy/strategy';
import { ConversationState, DebtorSnapshot, NbaDecision, NluResult, Tenant } from '../types';
import { llmText } from './llmClient';
import { WRITER_PROMPT } from './prompts';

function formatMoneyCop(value: number): string {
  return value.toLocaleString('es-CO');
}

function proactiveTemplate(input: {
  tenant: Tenant;
  debtor: DebtorSnapshot;
  conversation: ConversationState;
}): string {
  const amount = formatMoneyCop(input.debtor.totalDueCop);
  const days = input.debtor.daysPastDue;
  const org = input.tenant.name ?? 'tu entidad';

  const header =
    days <= 15
      ? `Hola. Te escribe ${org}. Registramos un saldo pendiente de $${amount} COP.`
      : days <= 60
      ? `Hola. Te escribe ${org}. Tu obligación presenta mora y el saldo pendiente es $${amount} COP.`
      : `Hola. Te escribe ${org}. Tu obligación está en mora avanzada y el saldo pendiente es $${amount} COP.`;

  const body =
    `

Opciones:
` +
    `1) Ver detalle
  ` +
    `2) Hacer acuerdo (descuento / cuotas)
  ` +
    `3) Pagar hoy
  ` +
    `4) Prometer una fecha de pago

` +
    `Responde con el número de la opción.`;

  return header + body;
}

function menuText(): string {
  return `Puedo ayudarte con tu obligación pendiente. Elige una opción:
1) Ver detalle
2) Hacer acuerdo
3) Pagar hoy
4) Prometer una fecha de pago`;
}

function clarifyByState(input: {
  tenant: Tenant;
  debtor: DebtorSnapshot;
  conversation: ConversationState;
}): string {
  const state = input.conversation.state ?? 'WELCOME';
  const amount = formatMoneyCop(input.debtor.totalDueCop);

  if (state === 'OFFER_MENU') {
    return `Para que cerremos un acuerdo, dime cuál opción te sirve (responde 1 o 2).

Si ninguna te encaja, dime: ¿cuánto podrías pagar hoy o en cuántas cuotas te quedaría mejor?`;
  }

  if (state === 'PAYMENT') {
    return `¿Quieres que te reenvíe el enlace para pagar hoy, o prefieres que armemos un acuerdo (cuotas/descuento) o una promesa de pago con fecha?`;
  }

  if (state === 'NEGOTIATION') {
    const hasAmount = typeof (input.conversation.slots?.promiseAmount as unknown) === 'number';
    const hasDate = typeof (input.conversation.slots?.promiseDate as unknown) === 'string';
    if (!hasAmount && !hasDate) {
      return 'Perfecto. Para ayudarte: ¿qué valor podrías pagar y para qué fecha? (Ej: “20 mil el martes”)';
    }

    if (!hasDate) {
      return 'Listo. ¿Para qué fecha podrías realizar el pago? (Ej: martes o 2026-01-20)';
    }

    if (!hasAmount) {
      return 'Gracias. ¿Qué valor podrías pagar ese día? (Ej: 20000 o “20 mil”)';
    }
    return 'Perfecto. ¿Confirmas que mantienes el monto y la fecha para registrarlo?';
  }

  if (state === 'DETAIL') {
    if ((input.debtor.totalDueCop ?? 0) > 0) {
      return `Tu saldo pendiente es $${amount} COP. ¿Qué prefieres hacer: pagar hoy, hacer un acuerdo o prometer una fecha de pago?`;
    }
    return '¿Qué prefieres hacer: pagar hoy, hacer un acuerdo o prometer una fecha de pago?';
  }

  // Default / welcome
  return 'Para ayudarte mejor, ¿qué deseas hacer: ver detalle, hacer acuerdo, pagar hoy o prometer una fecha de pago?';
}

function offersInline(offers: Offer[]): string {
  if (!offers.length) return '';
  const lines = offers.map((o, i) => {
    if (o.type === 'ONE_PAY') return `${i + 1}) ${o.label}: $${formatMoneyCop(o.amountTotalCop)}`;
    return `${i + 1}) ${o.label}: ${o.installments} x $${formatMoneyCop(
      o.amountPerInstallmentCop ?? 0
    )}`;
  });
  return lines.join('\n');
}

async function maybeRewriteWithLlm(params: {
  tenant: Tenant;
  debtor: DebtorSnapshot;
  conversation: ConversationState;
  nlu: NluResult;
  nba: NbaDecision;
  offers: Offer[];
  tone: string;
  draft: string;
}): Promise<string> {
  const enabled = process.env.LLM_REWRITE_ENABLED !== 'false';
  if (!enabled) return params.draft;

  // Only rewrite short, non-menu, non-link messages to preserve determinism.
  const nonRewritable = /https?:\/\//.test(params.draft) || /\n1\)/.test(params.draft);
  if (nonRewritable) return params.draft;

  const context = {
    tenantName: params.tenant.name,
    state: params.conversation.state,
    totalDueCop: params.debtor.totalDueCop,
    daysPastDue: params.debtor.daysPastDue,
    intent: params.nlu.intent,
    action: params.nba.action,
    offers: params.offers,
  };

  const prompt = WRITER_PROMPT.replace('{{tone}}', params.tone)
    .replace('{{contextJson}}', JSON.stringify(context))
    .replace('{{draft}}', params.draft);

  try {
    const out = (await llmText(prompt)).trim();
    if (!out) return params.draft;
    // Safety: prevent pathological long outputs.
    if (out.length > Math.max(800, params.draft.length * 4)) return params.draft;
    return out;
  } catch {
    return params.draft;
  }
}

export async function writeResponse(input: {
  tenant: Tenant;
  debtor: DebtorSnapshot;
  conversation: ConversationState;
  nlu: NluResult;
  nba: NbaDecision;
  offers: Offer[];
}): Promise<string> {
  const nba = input.nba as NbaDecision;

  if (nba.action === 'PROACTIVE_OUTREACH') {
    return proactiveTemplate({
      tenant: input.tenant,
      debtor: input.debtor,
      conversation: input.conversation,
    });
  }

  const strategy = computeConversationStrategy({
    tenantPolicy: input.tenant.policy,
    debtor: input.debtor,
  });
  const tone = strategy.tone;

  // Deterministic templates for critical actions (better than fully generative in MVP)
  let draft: string | undefined;
  switch (nba.action) {
    case 'GREET': {
      const org = input.tenant.name ?? 'tu entidad';
      draft = `Hola. Te escribe ${org}. ¿En qué te puedo ayudar hoy con tu obligación?

Puedes decir, por ejemplo: "ver detalle", "hacer acuerdo", "pagar hoy" o "prometer fecha".`;
      break;
    }
    case 'CLARIFY':
      draft = clarifyByState({
        tenant: input.tenant,
        debtor: input.debtor,
        conversation: input.conversation,
      });
      break;
    case 'OPT_OUT':
      draft =
        'Entendido. No te volveremos a contactar por este canal. Si deseas retomar, escribe ACUERDO o PAGO.';
      break;
    case 'ACK_ALREADY_PAID':
      draft =
        'Gracias por avisar. Para verificar el pago, ¿me confirmas por favor la fecha y el valor, y si fue por PSE, tarjeta o transferencia? Si tienes número de comprobante, también compártelo.';
      break;
    case 'ACK_DISPUTE':
      draft =
        'Entiendo. Si no reconoces la obligación o crees que hay un error, puedo ayudarte a revisar. ¿Me confirmas si eres el titular? Si prefieres, puedo escalar tu caso a un asesor para validación.';
      break;
    case 'DEESCALATE':
      draft =
        'Entiendo tu molestia. Mi intención es ayudarte a resolverlo de la forma más clara posible. ¿Quieres ver el detalle, pagar hoy, o buscar un acuerdo que te quede bien?';
      break;
    case 'PERSUADE': {
      const amount = formatMoneyCop(input.debtor.totalDueCop);
      const opts = offersInline(input.offers);
      draft = `Entiendo que ahora no quieras pagar. Solo para que lo tengas claro: mientras la obligación siga en mora, normalmente se generan intereses y costos, y el saldo puede incrementarse.

Si lo que buscas es una salida manejable, podemos cerrarlo con una opción que te quede cómoda. Tu saldo pendiente es $${amount} COP.

Opciones sugeridas:
${opts}

Responde con 1 o 2. Si ninguna te sirve, dime: ¿cuánto podrías pagar hoy y para qué fecha podrías completar el resto?`;
      break;
    }
    case 'END_REFUSAL':
      draft = `Entendido. Dejo constancia de que por ahora no deseas realizar el pago ni un acuerdo. No insistiremos en este momento.

    Si cambias de decisión, escribe ACUERDO, PAGO o una FECHA (YYYY-MM-DD) y lo retomamos.`;
      break;
    case 'REDIRECT_MENU':
    case 'FALLBACK_MENU':
      draft = menuText();
      break;

    case 'SHOW_DETAIL':
      draft = `Detalle de tu obligación:
- Saldo pendiente: ${
        input.debtor.totalDueCop > 0 ? `$${formatMoneyCop(input.debtor.totalDueCop)} COP` : 'N/D'
      }
- Días en mora: ${input.debtor.daysPastDue}
- Fecha de vencimiento: ${input.debtor.dueDate ?? 'N/D'}

Elige una opción:
1) Ver detalle
2) Hacer acuerdo
3) Pagar hoy
4) Prometer una fecha de pago`;
      break;
    case 'ASK_SLOT':
      if ((nba as any).slot === 'promiseDate')
        draft = 'Perfecto. ¿Para qué fecha podrías realizar el pago? (Ej: 2026-01-15)';
      if ((nba as any).slot === 'promiseAmount')
        draft = 'Gracias. ¿Qué valor podrías pagar? (Ej: 200000)';
      if (!draft) draft = '¿Qué medio de pago prefieres? (PSE, tarjeta, transferencia)';
      break;
    case 'SHOW_OFFERS': {
      const lines = input.offers.map((o, i) => {
        if (o.type === 'ONE_PAY')
          return `${i + 1}) ${o.label}: $${formatMoneyCop(o.amountTotalCop)}`;
        return `${i + 1}) ${o.label}: ${o.installments} x $${formatMoneyCop(
          o.amountPerInstallmentCop ?? 0
        )}`;
      });
      draft = `Tu saldo pendiente es $${formatMoneyCop(input.debtor.totalDueCop)}.
Opciones:
${lines.join('\n')}
Responde con el número de la opción. Si necesitas otra alternativa, dime cuánto podrías pagar hoy o en cuántas cuotas.`;
      break;
    }
    case 'SEND_PAYMENT_LINK':
      // In MVP this can be a placeholder; in production generate via Payment Link service.
      draft = `Listo. Para pagar hoy, usa este enlace: https://example.com/pago?ref=${encodeURIComponent(
        input.debtor.debtorId
      )}
Si prefieres un acuerdo, responde ACUERDO.`;
      break;
    case 'CREATE_PROMISE': {
      const a = (input.conversation?.slots?.promiseAmount ?? input.nlu.entities.amountCop) as
        | number
        | undefined;
      const d = (input.conversation?.slots?.promiseDate ?? input.nlu.entities.dateIso) as
        | string
        | undefined;
      draft = `Perfecto. Registramos tu promesa de pago por $${formatMoneyCop(a ?? 0)} para el ${
        d ?? ''
      }.`;
      break;
    }
    case 'COOLDOWN':
      draft = 'Entendido. No insistiremos por ahora. Te escribiremos nuevamente más adelante.';
      break;
    default:
      break;
  }

  if (draft) {
    return maybeRewriteWithLlm({
      tenant: input.tenant,
      debtor: input.debtor,
      conversation: input.conversation,
      nlu: input.nlu,
      nba: input.nba,
      offers: input.offers,
      tone,
      draft,
    });
  }

  // Optional generative (kept for future)
  const context = {
    tenantName: input.tenant.name,
    totalDueCop: input.debtor.totalDueCop,
    daysPastDue: input.debtor.daysPastDue,
    intent: input.nlu.intent,
    action: input.nba.action,
    offers: input.offers,
  };

  const prompt = WRITER_PROMPT.replace('{{tone}}', tone)
    .replace('{{contextJson}}', JSON.stringify(context))
    .replace('{{draft}}', 'Responde al usuario de forma breve y accionable.');

  return llmText(prompt);
}
