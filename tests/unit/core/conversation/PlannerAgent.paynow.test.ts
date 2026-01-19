import { describe, expect, it, vi } from 'vitest';

import { PlannerAgent } from '@/core/conversation/PlannerAgent';
import type { MultiAgentBudgetsSnapshot } from '@/core/types';

const llmJson = vi.fn();
vi.mock('@/core/llm/llmClient', () => ({
  llmJson: (...args: unknown[]) => llmJson(...args),
}));

describe('PlannerAgent PAY_NOW template selection', () => {
  it('selects negotiation.pay_now when intent is PAY_NOW', async () => {
    const budgets: MultiAgentBudgetsSnapshot = {
      abuseStrikeLimit: 3,
      counters: { negotiationRounds: 0, abuseStrikes: 0 },
    } as any;

    llmJson.mockResolvedValueOnce({
      actionType: 'OFFER_OPTIONS',
      options: ['PSE', 'Transferencia', 'Tarjeta'],
      stateBefore: 'WELCOME',
      stateAfter: 'WELCOME',
      budgetsSnapshot: {
        maxNegotiationRounds: 6,
        maxSlotAsksPerSlot: 2,
        maxOffTopicRedirects: 2,
        abuseStrikeLimit: 3,
        maxRepairAttempts: 2,
        counters: {
          negotiationRounds: 0,
          offTopicRedirects: 0,
          abuseStrikes: 0,
          repairAttempts: 0,
          slotAsks: {},
        },
      },
      complianceNotes: [],
    });

    const res = await PlannerAgent.run({
      classifier: {
        mode: 'NEGOTIATION',
        intent: 'PAY_NOW',
        flags: {},
      } as any,
      userText: 'quiero pagar hoy',
      conversationState: '{}',
      recentTurns: [],
      budgets,
      maxAttempts: 1,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const plan = res.value;
      expect(plan.actionType).toBe('INFORM_TEMPLATE');
      expect(plan.templateId).toBe('negotiation.pay_now');
    }
  });
});
