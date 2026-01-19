import { describe, expect, test, vi } from 'vitest';

import type { ClassifierOutput, PlannerOutput, WriterOutput } from '@/core/conversation/schemas';
import { VerifierAgent } from '@/core/conversation/VerifierAgent';

const llmJson = vi.fn();

vi.mock('@/core/llm/llmClient', () => ({
  llmJson: (...args: unknown[]) => llmJson(...args),
}));

describe('VerifierAgent deterministic mode guard', () => {
  test('WRONG_PERSON blocks debt details without calling LLM', async () => {
    const classifier: ClassifierOutput = {
      intent: 'WRONG_PERSON',
      mode: 'WRONG_PERSON',
      modeConfidence: 0.95,
      modeRationale: 'Wrong person.',
      entities: {},
      flags: {
        ambiguousAmount: false,
        ambiguousDate: false,
        contradiction: false,
        lowContext: false,
        sensitiveRequest: false,
        requiresHuman: false,
      },
      confidence: 0.9,
      rationale: 'User says wrong number.',
    };

    const plan: PlannerOutput = {
      actionType: 'ASK_SLOT',
      targetSlot: 'identityConfirmed',
      question: '¿Este número pertenece a la persona correcta?',
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
    };

    const writer: WriterOutput = {
      messageText: 'Entiendo. Tu saldo es $500.000 COP. ¿Confirmas si eres la persona?',
      askUser: true,
      metadata: { tone: 'T1', languageVariant: 'es-CO', includedSummary: false },
    };

    const res = await VerifierAgent.run({
      classifier,
      plan,
      writer,
      recentTurns: [],
      maxAttempts: 1,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.status).toBe('FAIL');
    expect(res.value.issues).toContain('POLICY_VIOLATION');
    expect(res.attempts).toBe(0);

    expect(llmJson).not.toHaveBeenCalled();
  });
});
