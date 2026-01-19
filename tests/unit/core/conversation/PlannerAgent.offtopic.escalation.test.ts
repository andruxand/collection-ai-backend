import { describe, expect, test, vi } from 'vitest';

import { PlannerAgent } from '@/core/conversation/PlannerAgent';
import type { MultiAgentBudgetsSnapshot } from '@/core/types';

const llmJson = vi.fn();
vi.mock('@/core/llm/llmClient', () => ({ llmJson: (...args: unknown[]) => llmJson(...args) }));

function makeBudgets(
  offTopicRedirects: number,
  maxOffTopicRedirects: number
): MultiAgentBudgetsSnapshot {
  return {
    maxNegotiationRounds: 6,
    maxSlotAsksPerSlot: 2,
    maxOffTopicRedirects,
    abuseStrikeLimit: 3,
    maxRepairAttempts: 2,
    counters: {
      negotiationRounds: 0,
      offTopicRedirects,
      abuseStrikes: 0,
      repairAttempts: 0,
      slotAsks: {},
    },
  } as any;
}

describe('PlannerAgent off-topic escalation', () => {
  test('final warning when offTopicRedirects == limit', async () => {
    const budgets = makeBudgets(2, 2);
    llmJson.mockResolvedValueOnce({
      actionType: 'REDIRECT',
      options: ['Hoy', 'Fecha'],
      stateBefore: 'WELCOME',
      stateAfter: 'WELCOME',
      budgetsSnapshot: budgets,
      complianceNotes: [],
    });

    const res = await PlannerAgent.run({
      classifier: { mode: 'NEGOTIATION', intent: 'OFF_TOPIC', flags: { lowContext: true } } as any,
      userText: '¿qué tal el desayuno?',
      conversationState: 'WELCOME',
      recentTurns: [],
      budgets,
      maxAttempts: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.actionType).toBe('INFORM_TEMPLATE');
    expect(res.value.templateId).toBe('negotiation.final_warning');
  });

  test('polite close when offTopicRedirects > limit', async () => {
    const budgets = makeBudgets(3, 2);
    llmJson.mockResolvedValueOnce({
      actionType: 'REDIRECT',
      options: ['Hoy', 'Fecha'],
      stateBefore: 'WELCOME',
      stateAfter: 'WELCOME',
      budgetsSnapshot: budgets,
      complianceNotes: [],
    });

    const res = await PlannerAgent.run({
      classifier: { mode: 'NEGOTIATION', intent: 'OFF_TOPIC', flags: { lowContext: true } } as any,
      userText: 'bla bla',
      conversationState: 'WELCOME',
      recentTurns: [],
      budgets,
      maxAttempts: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.actionType).toBe('INFORM_TEMPLATE');
    expect(res.value.templateId).toBe('negotiation.polite_close');
  });
});
