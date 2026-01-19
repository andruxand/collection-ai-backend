import { describe, expect, it } from 'vitest';

import { validateDialogueDecision } from '@/core/dialogue/dialogueManager';

describe('dialogue manager schema validation', () => {
  it('accepts a minimal decision shape', () => {
    const raw = {
      nlu: { intent: 'GREETING', entities: {}, confidence: 0.9, topicShift: false },
      nba: { action: 'GREET', nextState: 'WELCOME', slotsUpdate: {} },
      confidence: 0.8,
    };

    const out = validateDialogueDecision(raw);
    expect(out?.nlu.intent).toBe('GREETING');
    expect(out?.nba.action).toBe('GREET');
  });

  it('rejects unknown actions', () => {
    const raw = {
      nlu: { intent: 'GREETING', entities: {}, confidence: 0.9, topicShift: false },
      nba: { action: 'DO_SOMETHING', nextState: 'WELCOME', slotsUpdate: {} },
    };

    const out = validateDialogueDecision(raw);
    expect(out).toBeUndefined();
  });
});
