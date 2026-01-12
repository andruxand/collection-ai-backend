import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_POLICY } from '../tenant/defaults';
import type { ConversationState, DebtorSnapshot, NluResult, TenantPolicy } from '../types';
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

    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu });
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

    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu });
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

    const nba = nextBestAction({ tenantPolicy, debtor, conversation, nlu });
    expect(nba.action).toBe('SHOW_DETAIL');
  });
});
