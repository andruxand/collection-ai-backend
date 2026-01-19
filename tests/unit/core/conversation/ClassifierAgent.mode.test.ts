import { describe, expect, test, vi } from 'vitest';

import { ClassifierAgent } from '@/core/conversation/ClassifierAgent';

const llmJson = vi.fn();

vi.mock('@/core/llm/llmClient', () => ({
  llmJson: (...args: unknown[]) => llmJson(...args),
}));

describe('ClassifierAgent modes', () => {
  test('returns mode fields from LLM output (schema-enforced)', async () => {
    llmJson.mockResolvedValueOnce({
      intent: 'WRONG_PERSON',
      mode: 'WRONG_PERSON',
      modeConfidence: 0.93,
      modeRationale: 'User indicates this is the wrong person.',
      entities: {},
      flags: {
        ambiguousAmount: false,
        ambiguousDate: false,
        contradiction: false,
        lowContext: false,
        sensitiveRequest: false,
        requiresHuman: false,
      },
      confidence: 0.95,
      rationale: 'User says you have the wrong number.',
    });

    const res = await ClassifierAgent.run({
      userText: 'Número equivocado',
      debtor: { totalDueCop: 500000, daysPastDue: 30, stage: 'MID' },
      tenantPolicy: {
        handoffPolicy: { enabled: true, stageMin: 'MID', intents: ['DISPUTE'] },
        auditPolicy: { retentionDays: 30, storeMessageText: true, storeDecisionPayloads: true },
        tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' },
      },
      conversationState: 'WELCOME',
      recentTurns: [],
      maxAttempts: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.mode).toBe('WRONG_PERSON');
    expect(res.value.modeConfidence).toBeGreaterThan(0.5);
    expect(res.value.modeRationale).toContain('wrong');
  });
});
