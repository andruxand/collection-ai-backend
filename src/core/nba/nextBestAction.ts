import type { Offer } from '../offers/offerEngine';
import type {
  ConversationState,
  DebtorSnapshot,
  NbaDecision,
  NluResult,
  TenantPolicy,
} from '../types';

export function nextBestAction(input: {
  tenantPolicy: TenantPolicy;
  debtor: DebtorSnapshot;
  conversation: ConversationState;
  nlu: NluResult;
  offers: Offer[];
}): NbaDecision {
  const { conversation, nlu, tenantPolicy, offers } = input;
  const slots = conversation.slots ?? {};
  const state = conversation.state ?? 'WELCOME';
  const lastIntent = conversation.lastIntent;

  // If the NLU couldn't classify the intent but extracted a useful amount/date,
  // treat it as promise info (common for free-form messages like "tengo 20 mil" / "pago el martes").
  if (
    nlu.intent === 'UNKNOWN' &&
    (typeof nlu.entities.amountCop === 'number' || typeof nlu.entities.dateIso === 'string')
  ) {
    return nextBestAction({
      tenantPolicy,
      debtor: input.debtor,
      conversation,
      offers,
      nlu: { ...nlu, intent: 'PROMISE_PAYMENT', confidence: Math.max(nlu.confidence, 0.6) },
    });
  }

  // Short confirmations / denials should be interpreted in context.
  // This reduces the chance of falling back to menus when the user answers "sí/no".
  if (nlu.intent === 'AFFIRM') {
    if (state === 'PAYMENT' || lastIntent === 'PAY_NOW') {
      return { action: 'SEND_PAYMENT_LINK', nextState: 'PAYMENT', slotsUpdate: {} };
    }

    if (state === 'OFFER_MENU' || lastIntent === 'NEGOTIATE' || lastIntent === 'SELECT_OFFER') {
      // "Sí" without selecting an option: ask for the offer number.
      return { action: 'CLARIFY', nextState: 'OFFER_MENU', slotsUpdate: {} };
    }

    if (state === 'NEGOTIATION' || lastIntent === 'PROMISE_PAYMENT') {
      const hasDate = typeof (slots.promiseDate as unknown) === 'string';
      const hasAmount = typeof (slots.promiseAmount as unknown) === 'number';
      if (!hasDate)
        return {
          action: 'ASK_SLOT',
          slot: 'promiseDate',
          nextState: 'NEGOTIATION',
          slotsUpdate: {},
        };
      if (!hasAmount)
        return {
          action: 'ASK_SLOT',
          slot: 'promiseAmount',
          nextState: 'NEGOTIATION',
          slotsUpdate: {},
        };
    }

    // Default: ask the user to choose a concrete path.
    return { action: 'CLARIFY', nextState: state, slotsUpdate: {} };
  }

  if (nlu.intent === 'DENY') {
    if (state === 'PAYMENT' || lastIntent === 'PAY_NOW') {
      // User doesn't want to pay now -> show offers.
      return { action: 'SHOW_OFFERS', nextState: 'OFFER_MENU', slotsUpdate: {} };
    }

    if (state === 'OFFER_MENU') {
      // "No" to the shown options: keep negotiation open.
      return { action: 'CLARIFY', nextState: 'OFFER_MENU', slotsUpdate: {} };
    }

    if (state === 'DETAIL' || lastIntent === 'ASK_DETAIL') {
      return { action: 'SHOW_OFFERS', nextState: 'OFFER_MENU', slotsUpdate: {} };
    }

    return { action: 'CLARIFY', nextState: state, slotsUpdate: {} };
  }

  if (nlu.intent === 'REFUSE_PAY') {
    const refusalCount = (typeof slots.refusalCount === 'number' ? slots.refusalCount : 0) + 1;

    // First refusal: respond like a skilled collector (empathy + options), keep it in the negotiated path.
    if (refusalCount <= 1) {
      return {
        action: 'PERSUADE',
        nextState: 'OFFER_MENU',
        slotsUpdate: { refusalCount },
      };
    }

    // Repeated refusal: record and stop the automated conversation for now.
    const next = new Date(
      Date.now() + tenantPolicy.cooldowns.rejectedOfferDays * 24 * 60 * 60 * 1000
    ).toISOString();

    return {
      action: 'END_REFUSAL',
      nextState: 'DONE',
      slotsUpdate: { refusalCount, refusedPay: true },
      nextContactAllowedAt: next,
    };
  }

  if (nlu.intent === 'ALREADY_PAID') {
    return { action: 'ACK_ALREADY_PAID', nextState: 'WELCOME', slotsUpdate: {} };
  }

  if (nlu.intent === 'DISPUTE') {
    return { action: 'ACK_DISPUTE', nextState: 'WELCOME', slotsUpdate: {} };
  }

  if (nlu.intent === 'ANGRY') {
    return { action: 'DEESCALATE', nextState: 'WELCOME', slotsUpdate: {} };
  }

  if (nlu.intent === 'GREETING') {
    return { action: 'GREET', nextState: conversation.state ?? 'WELCOME', slotsUpdate: {} };
  }

  if (nlu.intent === 'OPT_OUT') {
    return { action: 'OPT_OUT', nextState: 'DONE', slotsUpdate: { optedOut: true } };
  }

  if (nlu.intent === 'OFFTOPIC') {
    // Prefer a natural clarification in the common states to avoid menu loops.
    if (
      state === 'WELCOME' ||
      state === 'OFFER_MENU' ||
      state === 'DETAIL' ||
      state === 'PAYMENT'
    ) {
      return { action: 'CLARIFY', nextState: state, slotsUpdate: {} };
    }
    return { action: 'REDIRECT_MENU', nextState: state, slotsUpdate: {} };
  }

  if (nlu.intent === 'SYSTEM_TICK') {
    return {
      action: 'PROACTIVE_OUTREACH',
      nextState: conversation.state ?? 'WELCOME',
      slotsUpdate: {},
    };
  }

  if (nlu.intent === 'PROMISE_PAYMENT') {
    const amount = nlu.entities.amountCop ?? (slots.promiseAmount as number | undefined);
    const date = nlu.entities.dateIso ?? (slots.promiseDate as string | undefined);

    if (!date)
      return { action: 'ASK_SLOT', slot: 'promiseDate', nextState: 'NEGOTIATION', slotsUpdate: {} };
    if (!amount)
      return {
        action: 'ASK_SLOT',
        slot: 'promiseAmount',
        nextState: 'NEGOTIATION',
        slotsUpdate: {},
      };

    return {
      action: 'CREATE_PROMISE',
      nextState: 'REMINDERS',
      slotsUpdate: { promiseDate: date, promiseAmount: amount },
    };
  }

  if (nlu.intent === 'SELECT_OFFER') {
    const idx = nlu.entities.offerIndex;
    const offer = typeof idx === 'number' ? offers[idx - 1] : undefined;
    if (!offer) {
      return { action: 'CLARIFY', nextState: 'OFFER_MENU', slotsUpdate: {} };
    }

    if (offer.type === 'ONE_PAY') {
      return {
        action: 'SEND_PAYMENT_LINK',
        nextState: 'PAYMENT',
        slotsUpdate: { selectedOfferId: offer.id },
      };
    }

    // Installments: capture a first-payment promise as a deterministic MVP.
    const firstPaymentAmount = offer.amountPerInstallmentCop ?? undefined;
    return {
      action: 'ASK_SLOT',
      slot: 'promiseDate',
      nextState: 'NEGOTIATION',
      slotsUpdate: {
        selectedOfferId: offer.id,
        ...(firstPaymentAmount ? { promiseAmount: firstPaymentAmount } : {}),
      },
    };
  }

  if (nlu.intent === 'NEGOTIATE') {
    return { action: 'SHOW_OFFERS', nextState: 'OFFER_MENU', slotsUpdate: {} };
  }

  if (nlu.intent === 'ASK_DETAIL') {
    return { action: 'SHOW_DETAIL', nextState: 'DETAIL', slotsUpdate: {} };
  }

  if (nlu.intent === 'PAY_NOW') {
    return { action: 'SEND_PAYMENT_LINK', nextState: 'PAYMENT', slotsUpdate: {} };
  }

  // Simple cooldown if too many attempts
  if (conversation.attemptCount >= tenantPolicy.offerPolicy.maxAttempts) {
    const next = new Date(
      Date.now() + tenantPolicy.cooldowns.rejectedOfferDays * 24 * 60 * 60 * 1000
    ).toISOString();
    return {
      action: 'COOLDOWN',
      nextState: 'COOLDOWN',
      slotsUpdate: {},
      nextContactAllowedAt: next,
    };
  }

  // Unknown: avoid jumping to menus immediately on first contact.
  if (
    (state === 'WELCOME' && (conversation.attemptCount ?? 0) <= 1) ||
    state === 'OFFER_MENU' ||
    state === 'NEGOTIATION' ||
    state === 'DETAIL' ||
    state === 'PAYMENT'
  ) {
    return { action: 'CLARIFY', nextState: state, slotsUpdate: {} };
  }

  return { action: 'FALLBACK_MENU', nextState: state, slotsUpdate: {} };
}
