import { describe, expect, test, vi } from 'vitest';

import { PlannerAgent } from '@/core/conversation/PlannerAgent';
import type { ClassifierOutput } from '@/core/conversation/schemas';
import type { MultiAgentBudgetsSnapshot, MultiAgentMemoryTurn } from '@/core/types';

const llmJson = vi.fn();

vi.mock('@/core/llm/llmClient', () => ({
  llmJson: (...args: unknown[]) => llmJson(...args),
}));

type BudgetsOverrides = Omit<Partial<MultiAgentBudgetsSnapshot>, 'counters'> & {
  counters?: Partial<MultiAgentBudgetsSnapshot['counters']>;
};

function makeBudgets(partial?: BudgetsOverrides): MultiAgentBudgetsSnapshot {
  const base: MultiAgentBudgetsSnapshot = {
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
  };

  const merged = { ...base, ...(partial ?? {}) };
  return {
    ...merged,
    counters: {
      ...base.counters,
      ...(partial?.counters ?? {}),
    },
  };
}

function makeClassifier(partial: Partial<ClassifierOutput>): ClassifierOutput {
  return {
    intent: 'PAY_LATER',
    mode: 'NEGOTIATION',
    modeConfidence: 0.7,
    modeRationale: 'Default.',
    entities: {},
    flags: {
      ambiguousAmount: false,
      ambiguousDate: false,
      contradiction: false,
      lowContext: false,
      sensitiveRequest: false,
      requiresHuman: false,
    },
    confidence: 0.8,
    rationale: 'Test.',
    ...partial,
  };
}

describe('PlannerAgent mode enforcement', () => {
  test('WRONG_PERSON forces INFORM_TEMPLATE safe exit', async () => {
    llmJson.mockResolvedValueOnce({
      actionType: 'OFFER_OPTIONS',
      options: ['Hoy', 'Mañana'],
      stateBefore: 'WELCOME',
      stateAfter: 'WELCOME',
      budgetsSnapshot: makeBudgets(),
      complianceNotes: [],
    });

    const res = await PlannerAgent.run({
      classifier: makeClassifier({ intent: 'WRONG_PERSON', mode: 'WRONG_PERSON' }),
      userText: 'Número equivocado',
      conversationState: 'WELCOME',
      recentTurns: [] as MultiAgentMemoryTurn[],
      budgets: makeBudgets(),
      offersSummary: { offersCount: 0 },
      maxAttempts: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.actionType).toBe('INFORM_TEMPLATE');
    expect(res.value.templateId).toBe('wrong_person.safe_exit');
    expect(res.value.targetSlot).toBeUndefined();
    expect(res.value.question).toBeUndefined();
  });

  test('HUMAN_HANDOFF forces ESCALATE', async () => {
    llmJson.mockResolvedValueOnce({
      actionType: 'CONFIRM',
      stateBefore: 'WELCOME',
      stateAfter: 'WELCOME',
      budgetsSnapshot: makeBudgets(),
      complianceNotes: [],
      summaryToConfirm: { amountCop: 100000, dateIso: '2026-01-20', paymentMethod: 'PSE' },
    });

    const res = await PlannerAgent.run({
      classifier: makeClassifier({ intent: 'DISPUTE', mode: 'HUMAN_HANDOFF' }),
      userText: 'Quiero hablar con un asesor',
      conversationState: 'WELCOME',
      recentTurns: [] as MultiAgentMemoryTurn[],
      budgets: makeBudgets(),
      offersSummary: { offersCount: 0 },
      maxAttempts: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.actionType).toBe('ESCALATE');
    expect(res.value.summaryToConfirm).toBeUndefined();
  });

  test('ABUSE_DEESCALATION ends after strike limit', async () => {
    llmJson.mockResolvedValueOnce({
      actionType: 'OFFER_OPTIONS',
      options: ['Hoy', 'Esta semana'],
      stateBefore: 'WELCOME',
      stateAfter: 'WELCOME',
      budgetsSnapshot: makeBudgets(),
      complianceNotes: [],
    });

    const res = await PlannerAgent.run({
      classifier: makeClassifier({ intent: 'ABUSIVE', mode: 'ABUSE_DEESCALATION' }),
      userText: 'Insultos',
      conversationState: 'WELCOME',
      recentTurns: [] as MultiAgentMemoryTurn[],
      budgets: makeBudgets({ counters: { abuseStrikes: 3 }, abuseStrikeLimit: 3 }),
      offersSummary: { offersCount: 0 },
      maxAttempts: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.actionType).toBe('END');
  });
});
