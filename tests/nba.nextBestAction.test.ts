import { describe, expect, it } from 'vitest';

import { nextBestAction } from '../src/core/nba/nextBestAction';

describe('nextBestAction (robust promise flow)', () => {
  it('treats UNKNOWN with amount/date entities as PROMISE_PAYMENT', () => {
    const nba = nextBestAction({
      tenantPolicy: {
        cooldowns: { rejectedOfferDays: 2, noResponseDays: 2, brokenPromiseDays: 2 },
        offerPolicy: { maxAttempts: 5 },
      } as any,
      debtor: {
        tenantId: 't',
        debtorId: 'd',
        totalDueCop: 100_000,
        daysPastDue: 10,
        stage: 'EARLY',
        consents: { whatsapp: true, telegram: true },
      },
      conversation: { state: 'NEGOTIATION', slots: {}, attemptCount: 1 },
      nlu: {
        intent: 'UNKNOWN',
        confidence: 0.2,
        topicShift: false,
        entities: { amountCop: 20_000 },
      },
      offers: [],
    });

    // With amount only, the system should ask for the missing date.
    expect(nba.action).toBe('ASK_SLOT');
    expect((nba as any).slot).toBe('promiseDate');
  });

  it('does not fall back to menu on UNKNOWN in NEGOTIATION', () => {
    const nba = nextBestAction({
      tenantPolicy: {
        cooldowns: { rejectedOfferDays: 2, noResponseDays: 2, brokenPromiseDays: 2 },
        offerPolicy: { maxAttempts: 50 },
      } as any,
      debtor: {
        tenantId: 't',
        debtorId: 'd',
        totalDueCop: 100_000,
        daysPastDue: 10,
        stage: 'EARLY',
        consents: { whatsapp: true, telegram: true },
      },
      conversation: { state: 'NEGOTIATION', slots: {}, attemptCount: 2 },
      nlu: {
        intent: 'UNKNOWN',
        confidence: 0.2,
        topicShift: false,
        entities: {},
      },
      offers: [],
    });

    expect(nba.action).toBe('CLARIFY');
  });
});
