import { describe, expect, it } from 'vitest';

import { computeConversationStrategy } from '@/core/strategy/strategy';
import type { DebtorSnapshot, TenantPolicy } from '@/core/types';

function makePolicy(overrides?: Partial<TenantPolicy>): TenantPolicy {
  return {
    contactPolicy: {
      timezone: 'America/Bogota',
      maxContactsPerDay: 5,
      noMultichannelSameWeekAfterDirectContact: false,
      hours: {
        monFri: { from: '08:00', to: '18:00' },
        sat: { from: '09:00', to: '13:00' },
        sunBlocked: true,
        holidaysBlocked: false,
      },
    },
    contactLimitsByStage: {
      EARLY: { maxOutboundPerDay: 10, maxOutboundPerWeek: 10 },
      MID: { maxOutboundPerDay: 10, maxOutboundPerWeek: 10 },
      LATE: { maxOutboundPerDay: 10, maxOutboundPerWeek: 10 },
    },
    cooldowns: { rejectedOfferDays: 3, noResponseDays: 3, brokenPromiseDays: 7 },
    offerPolicy: {
      ladder: [{ attempt: 1, maxDiscountPct: 0 }],
      maxAttempts: 3,
      hardCapDiscountPct: 30,
    },
    auditPolicy: { retentionDays: 7, storeMessageText: true, storeDecisionPayloads: true },
    exportPolicy: { enabled: false },
    notificationPolicy: {
      email: {
        enabled: false,
        fromAddress: 'x',
        toAddresses: [],
        subjectPrefix: '',
        includeInboundText: false,
      },
    },
    handoffPolicy: {
      enabled: false,
      stageMin: 'MID',
      intents: ['ANGRY'],
      retentionDays: 30,
      storeInboundText: true,
    },
    tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' },
    ...overrides,
  };
}

function makeDebtor(overrides?: Partial<DebtorSnapshot>): DebtorSnapshot {
  return {
    tenantId: 't',
    debtorId: 'd',
    totalDueCop: 500000,
    daysPastDue: 5,
    stage: 'EARLY',
    consents: { whatsapp: true, telegram: false },
    ...overrides,
  };
}

describe('computeConversationStrategy', () => {
  it('defaults to NUDGE for very early delinquency when no strategyPolicy is configured', () => {
    const res = computeConversationStrategy({
      tenantPolicy: makePolicy({ strategyPolicy: undefined }),
      debtor: makeDebtor({ daysPastDue: 3 }),
    });
    expect(res.objective).toBe('NUDGE');
  });

  it('defaults to NEGOTIATE when daysPastDue > 7 and no strategyPolicy is configured', () => {
    const res = computeConversationStrategy({
      tenantPolicy: makePolicy({ strategyPolicy: undefined }),
      debtor: makeDebtor({ daysPastDue: 20 }),
    });
    expect(res.objective).toBe('NEGOTIATE');
  });

  it('matches the first rule and returns its objective + playbook', () => {
    const res = computeConversationStrategy({
      tenantPolicy: makePolicy({
        strategyPolicy: {
          defaultObjective: 'NEGOTIATE',
          objectivePlaybook: {
            COLLECT_NOW: {
              goal: 'Cerrar pago hoy si es viable.',
              primaryAction: 'SEND_PAYMENT_LINK',
              secondaryAction: 'SHOW_OFFERS',
            },
          },
          rules: [
            { when: { minDaysPastDue: 60 }, objective: 'COLLECT_NOW', toneKey: 'T3' },
            { when: { maxDaysPastDue: 7 }, objective: 'NUDGE', toneKey: 'T1' },
          ],
        },
      }),
      debtor: makeDebtor({ daysPastDue: 90 }),
    });

    expect(res.objective).toBe('COLLECT_NOW');
    expect(res.playbook?.primaryAction).toBe('SEND_PAYMENT_LINK');
    expect(res.matchedRuleIndex).toBe(0);
  });
});
