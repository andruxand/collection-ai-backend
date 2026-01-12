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
}): NbaDecision {
  const { conversation, nlu, tenantPolicy } = input;
  const slots = conversation.slots ?? {};

  if (nlu.intent === 'OPT_OUT') {
    return { action: 'OPT_OUT', nextState: 'DONE', slotsUpdate: { optedOut: true } };
  }

  if (nlu.intent === 'OFFTOPIC') {
    return { action: 'REDIRECT_MENU', nextState: conversation.state ?? 'WELCOME', slotsUpdate: {} };
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

  return { action: 'FALLBACK_MENU', nextState: conversation.state ?? 'WELCOME', slotsUpdate: {} };
}
