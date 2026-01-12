import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_POLICY } from '../tenant/defaults';
import type { ConversationState, DebtorSnapshot, NluResult, TenantPolicy } from '../types';
import { buildOffers } from '../offers/offerEngine';
import { nextBestAction } from './nextBestAction';

describe('nextBestAction', () => {
  it('returns GREET for GREETING', () => {
    const tenantPolicy: TenantPolicy = { ...DEFAULT_TENANT_POLICY };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd',
      totalDueCop: 100000,
      daysPastDue: 10,
      stage: 'EARLY',
      consents: { whatsapp: true, telegram: false },
    };

    const conversation: ConversationState = {
      state: 'WELCOME',
      slots: {},
      attemptCount: 0,
      lastIntent: 'UNKNOWN',
    };

    const nlu: NluResult = {
      intent: 'GREETING',
      entities: {},
      confidence: 1,
      topicShift: false,
    };

    const offers = buildOffers({ tenantPolicy, debtor, conversation });
    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu, offers });
    expect(nba.action).toBe('GREET');
  });

  it('returns PROACTIVE_OUTREACH for SYSTEM_TICK', () => {
    const tenantPolicy: TenantPolicy = { ...DEFAULT_TENANT_POLICY };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd',
      totalDueCop: 100000,
      daysPastDue: 10,
      stage: 'EARLY',
      consents: { whatsapp: true, telegram: false },
    };

    const conversation: ConversationState = {
      state: 'WELCOME',
      slots: {},
      attemptCount: 0,
      lastIntent: 'UNKNOWN',
    };

    const nlu: NluResult = {
      intent: 'SYSTEM_TICK',
      entities: {},
      confidence: 1,
      topicShift: false,
    };

    const offers = buildOffers({ tenantPolicy, debtor, conversation });
    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu, offers });
    expect(nba.action).toBe('PROACTIVE_OUTREACH');
  });

  it('returns SHOW_DETAIL for ASK_DETAIL', () => {
    const tenantPolicy: TenantPolicy = { ...DEFAULT_TENANT_POLICY };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd',
      totalDueCop: 100000,
      daysPastDue: 10,
      stage: 'EARLY',
      consents: { whatsapp: true, telegram: false },
    };

    const conversation: ConversationState = {
      state: 'WELCOME',
      slots: {},
      attemptCount: 0,
      lastIntent: 'UNKNOWN',
    };

    const nlu: NluResult = {
      intent: 'ASK_DETAIL',
      entities: {},
      confidence: 1,
      topicShift: false,
    };

    const offers = buildOffers({ tenantPolicy, debtor, conversation });
    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu, offers });
    expect(nba.action).toBe('SHOW_DETAIL');
  });

  it('selecting offer #1 routes to SEND_PAYMENT_LINK', () => {
    const tenantPolicy: TenantPolicy = { ...DEFAULT_TENANT_POLICY };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd',
      totalDueCop: 100000,
      daysPastDue: 10,
      stage: 'EARLY',
      consents: { whatsapp: true, telegram: false },
    };

    const conversation: ConversationState = {
      state: 'OFFER_MENU',
      slots: {},
      attemptCount: 1,
      lastIntent: 'NEGOTIATE',
    };

    const offers = buildOffers({ tenantPolicy, debtor, conversation });
    const nlu: NluResult = {
      intent: 'SELECT_OFFER',
      entities: { offerIndex: 1 },
      confidence: 0.95,
      topicShift: false,
    };

    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu, offers });
    expect(nba.action).toBe('SEND_PAYMENT_LINK');
    expect(nba.nextState).toBe('PAYMENT');
  });

  it('selecting offer #2 asks for promiseDate (installments MVP)', () => {
    const tenantPolicy: TenantPolicy = { ...DEFAULT_TENANT_POLICY };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd',
      totalDueCop: 100000,
      daysPastDue: 10,
      stage: 'EARLY',
      consents: { whatsapp: true, telegram: false },
    };

    const conversation: ConversationState = {
      state: 'OFFER_MENU',
      slots: {},
      attemptCount: 1,
      lastIntent: 'NEGOTIATE',
    };

    const offers = buildOffers({ tenantPolicy, debtor, conversation });
    const nlu: NluResult = {
      intent: 'SELECT_OFFER',
      entities: { offerIndex: 2 },
      confidence: 0.95,
      topicShift: false,
    };

    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu, offers });
    expect(nba.action).toBe('ASK_SLOT');
    expect((nba as any).slot).toBe('promiseDate');
    expect(nba.nextState).toBe('NEGOTIATION');
  });

  it('AFFIRM in PAYMENT resends payment link', () => {
    const tenantPolicy: TenantPolicy = { ...DEFAULT_TENANT_POLICY };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd',
      totalDueCop: 100000,
      daysPastDue: 10,
      stage: 'EARLY',
      consents: { whatsapp: true, telegram: false },
    };

    const conversation: ConversationState = {
      state: 'PAYMENT',
      slots: {},
      attemptCount: 1,
      lastIntent: 'PAY_NOW',
    };

    const offers = buildOffers({ tenantPolicy, debtor, conversation });
    const nlu: NluResult = {
      intent: 'AFFIRM',
      entities: {},
      confidence: 0.85,
      topicShift: false,
    };

    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu, offers });
    expect(nba.action).toBe('SEND_PAYMENT_LINK');
    expect(nba.nextState).toBe('PAYMENT');
  });

  it('DENY in PAYMENT shows offers instead of looping', () => {
    const tenantPolicy: TenantPolicy = { ...DEFAULT_TENANT_POLICY };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd',
      totalDueCop: 100000,
      daysPastDue: 10,
      stage: 'EARLY',
      consents: { whatsapp: true, telegram: false },
    };

    const conversation: ConversationState = {
      state: 'PAYMENT',
      slots: {},
      attemptCount: 1,
      lastIntent: 'PAY_NOW',
    };

    const offers = buildOffers({ tenantPolicy, debtor, conversation });
    const nlu: NluResult = {
      intent: 'DENY',
      entities: {},
      confidence: 0.85,
      topicShift: false,
    };

    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu, offers });
    expect(nba.action).toBe('SHOW_OFFERS');
    expect(nba.nextState).toBe('OFFER_MENU');
  });

  it('refusal to pay triggers PERSUADE first, then END_REFUSAL on repeat', () => {
    const tenantPolicy: TenantPolicy = { ...DEFAULT_TENANT_POLICY };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd',
      totalDueCop: 100000,
      daysPastDue: 10,
      stage: 'EARLY',
      consents: { whatsapp: true, telegram: false },
    };

    const conversation1: ConversationState = {
      state: 'DETAIL',
      slots: {},
      attemptCount: 1,
      lastIntent: 'ASK_DETAIL',
    };

    const offers1 = buildOffers({ tenantPolicy, debtor, conversation: conversation1 });
    const nlu1: NluResult = {
      intent: 'REFUSE_PAY',
      entities: {},
      confidence: 0.9,
      topicShift: false,
    };

    const nba1 = nextBestAction({ tenantPolicy, debtor, conversation: conversation1, nlu: nlu1, offers: offers1 });
    expect(nba1.action).toBe('PERSUADE');
    expect(nba1.nextState).toBe('OFFER_MENU');

    const conversation2: ConversationState = {
      ...conversation1,
      slots: { refusalCount: 1 },
    };
    const offers2 = buildOffers({ tenantPolicy, debtor, conversation: conversation2 });
    const nba2 = nextBestAction({ tenantPolicy, debtor, conversation: conversation2, nlu: nlu1, offers: offers2 });
    expect(nba2.action).toBe('END_REFUSAL');
    expect(nba2.nextState).toBe('DONE');
    expect(typeof (nba2 as any).nextContactAllowedAt).toBe('string');
  });
});
