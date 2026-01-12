import { Offer } from '../offers/offerEngine';
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

  const tone = (() => {
    // Deterministic tone mapping (MVP)
    if (input.debtor.daysPastDue <= 15) return input.tenant.policy.tonePolicy.T1;
    if (input.debtor.daysPastDue <= 60) return input.tenant.policy.tonePolicy.T2;
    return input.tenant.policy.tonePolicy.T3;
  })();

  // Deterministic templates for critical actions (better than fully generative in MVP)
  switch (nba.action) {
    case 'OPT_OUT':
      return 'Entendido. No te volveremos a contactar por este canal. Si deseas retomar, escribe ACUERDO o PAGO.';
    case 'REDIRECT_MENU':
    case 'FALLBACK_MENU':
      return `Puedo ayudarte con tu obligación pendiente. Elige una opción:
1) Ver detalle
2) Hacer acuerdo
3) Pagar hoy
4) Prometer una fecha de pago`;

    case 'SHOW_DETAIL':
      return `Detalle de tu obligación:
- Saldo pendiente: $${formatMoneyCop(input.debtor.totalDueCop)}
- Días en mora: ${input.debtor.daysPastDue}
- Fecha de vencimiento: ${input.debtor.dueDate ?? 'N/D'}

Elige una opción:
1) Ver detalle
2) Hacer acuerdo
3) Pagar hoy
4) Prometer una fecha de pago`;
    case 'ASK_SLOT':
      if ((nba as any).slot === 'promiseDate')
        return 'Perfecto. ¿Para qué fecha podrías realizar el pago? (Ej: 2026-01-15)';
      if ((nba as any).slot === 'promiseAmount')
        return 'Gracias. ¿Qué valor podrías pagar? (Ej: 200000)';
      return '¿Qué medio de pago prefieres? (PSE, tarjeta, transferencia)';
    case 'SHOW_OFFERS': {
      const lines = input.offers.map((o, i) => {
        if (o.type === 'ONE_PAY')
          return `${i + 1}) ${o.label}: $${formatMoneyCop(o.amountTotalCop)}`;
        return `${i + 1}) ${o.label}: ${o.installments} x $${formatMoneyCop(
          o.amountPerInstallmentCop ?? 0
        )}`;
      });
      return `Tu saldo pendiente es $${formatMoneyCop(input.debtor.totalDueCop)}.
Opciones:
${lines.join('\n')}
    Responde con el número de la opción.`;
    }
    case 'SEND_PAYMENT_LINK':
      // In MVP this can be a placeholder; in production generate via Payment Link service.
      return `Listo. Para pagar hoy, usa este enlace: https://example.com/pago?ref=${encodeURIComponent(
        input.debtor.debtorId
      )}
Si prefieres un acuerdo, responde ACUERDO.`;
    case 'CREATE_PROMISE': {
      const a = (input.conversation?.slots?.promiseAmount ?? input.nlu.entities.amountCop) as
        | number
        | undefined;
      const d = (input.conversation?.slots?.promiseDate ?? input.nlu.entities.dateIso) as
        | string
        | undefined;
      return `Perfecto. Registramos tu promesa de pago por $${formatMoneyCop(a ?? 0)} para el ${
        d ?? ''
      }. Responde SI para confirmar.`;
    }
    case 'COOLDOWN':
      return 'Entendido. No insistiremos por ahora. Te escribiremos nuevamente más adelante.';
    default:
      break;
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

  const prompt = WRITER_PROMPT.replace('{{tone}}', tone).replace(
    '{{contextJson}}',
    JSON.stringify(context)
  );

  return llmText(prompt);
}
