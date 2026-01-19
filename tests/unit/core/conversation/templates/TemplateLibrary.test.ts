import { describe, expect, test } from 'vitest';

import { TemplateLibrary } from '@/core/conversation/templates/TemplateLibrary';
import type { TenantPolicy } from '@/core/types';

function makePolicy(): TenantPolicy {
  return {
    contactPolicy: {
      timezone: 'America/Bogota',
      maxContactsPerDay: 2,
      noMultichannelSameWeekAfterDirectContact: true,
      hours: {
        monFri: { from: '08:00', to: '18:00' },
        sat: { from: '09:00', to: '13:00' },
        sunBlocked: true,
        holidaysBlocked: true,
      },
    },
    contactLimitsByStage: {
      EARLY: { maxOutboundPerDay: 1, maxOutboundPerWeek: 3 },
      MID: { maxOutboundPerDay: 1, maxOutboundPerWeek: 2 },
      LATE: { maxOutboundPerDay: 1, maxOutboundPerWeek: 1 },
    },
    cooldowns: { rejectedOfferDays: 2, noResponseDays: 3, brokenPromiseDays: 7 },
    offerPolicy: {
      ladder: [{ attempt: 1, maxDiscountPct: 0 }],
      maxAttempts: 6,
      hardCapDiscountPct: 20,
    },
    auditPolicy: { retentionDays: 30, storeMessageText: true, storeDecisionPayloads: true },
    exportPolicy: { enabled: false },
    notificationPolicy: {
      email: {
        enabled: false,
        fromAddress: '',
        toAddresses: [],
        subjectPrefix: '[CollectionsAI]',
        includeInboundText: false,
      },
    },
    handoffPolicy: { enabled: true, stageMin: 'MID', intents: ['DISPUTE', 'ANGRY'] },
    tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' },
    conversationPolicy: {
      multiAgentOrchestration: {
        enabled: true,
        maxRepairAttempts: 2,
        budgets: {
          maxNegotiationRounds: 6,
          maxSlotAsksPerSlot: 2,
          maxOffTopicRedirects: 2,
          abuseStrikeLimit: 3,
        },
      },
    },
  };
}

describe('TemplateLibrary', () => {
  test('renders WRONG_PERSON safe exit deterministically', () => {
    const res = TemplateLibrary.render({
      templateId: 'wrong_person.safe_exit',
      mode: 'WRONG_PERSON',
      tenantConfig: { tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' } },
      tenantPolicy: makePolicy(),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.messageText).toContain('Gracias por avisar');
    expect(res.value.messageText).not.toContain('{{');
  });

  test('derives hours from policy when missing', () => {
    const res = TemplateLibrary.render({
      templateId: 'info.how_to_pay',
      mode: 'NEGOTIATION',
      tenantConfig: { tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' } },
      vars: {},
      tenantPolicy: makePolicy(),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.messageText).toContain('Horarios de atención:');
    expect(res.value.messageText).not.toContain('{{hours}}');
    expect(res.value.varsUsed).toHaveProperty('hours');
  });

  test('fails when required link variable is missing', () => {
    const res = TemplateLibrary.render({
      templateId: 'info.payment_link',
      mode: 'NEGOTIATION',
      tenantConfig: { tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' } },
      vars: {},
      tenantPolicy: makePolicy(),
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;

    expect(res.error).toContain('Missing required variable');
    expect(res.error).toContain('link');
  });

  test('tracks varsUsed for link', () => {
    const res = TemplateLibrary.render({
      templateId: 'info.payment_link',
      mode: 'NEGOTIATION',
      tenantConfig: { tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' } },
      vars: { link: 'https://example.com/pago' },
      tenantPolicy: makePolicy(),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.messageText).toContain('https://example.com/pago');
    expect(res.value.varsUsed).toMatchObject({ link: 'https://example.com/pago' });
  });
});
