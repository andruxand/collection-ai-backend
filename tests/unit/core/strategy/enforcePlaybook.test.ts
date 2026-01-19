import { describe, expect, it } from 'vitest';

import { enforcePlaybookOnNba } from '@/core/strategy/enforcePlaybook';
import type { ConversationStrategy } from '@/core/strategy/strategy';
import type { NbaDecision, NluResult } from '@/core/types';

function makeNlu(intent: NluResult['intent']): NluResult {
  return { intent, entities: {}, confidence: 0.9, topicShift: false };
}

function makeStrategy(overrides?: Partial<ConversationStrategy>): ConversationStrategy {
  return {
    objective: 'NEGOTIATE',
    tone: 't',
    playbook: { goal: 'x', primaryAction: 'SHOW_OFFERS', secondaryAction: 'CLARIFY' },
    ...overrides,
  };
}

describe('enforcePlaybookOnNba', () => {
  it('overrides menu-loop action to playbook primaryAction when viable', () => {
    const nba: NbaDecision = { action: 'FALLBACK_MENU', nextState: 'WELCOME', slotsUpdate: {} };
    const res = enforcePlaybookOnNba({
      nba,
      nlu: makeNlu('NEGOTIATE'),
      strategy: makeStrategy(),
      offersCount: 2,
    });

    expect(res.nba.action).toBe('SHOW_OFFERS');
    expect(res.nba.nextState).toBe('OFFER_MENU');
    expect(res.enforcement?.reason).toBe('playbook_primary');
  });

  it('falls back to secondaryAction when primary is not viable', () => {
    const nba: NbaDecision = { action: 'REDIRECT_MENU', nextState: 'WELCOME', slotsUpdate: {} };
    const res = enforcePlaybookOnNba({
      nba,
      nlu: makeNlu('NEGOTIATE'),
      strategy: makeStrategy({
        playbook: { goal: 'x', primaryAction: 'SHOW_OFFERS', secondaryAction: 'CLARIFY' },
      }),
      offersCount: 0,
    });

    expect(res.nba.action).toBe('CLARIFY');
    expect(res.enforcement?.reason).toBe('playbook_secondary');
  });

  it('does not override in sensitive intents', () => {
    const nba: NbaDecision = { action: 'FALLBACK_MENU', nextState: 'WELCOME', slotsUpdate: {} };
    const res = enforcePlaybookOnNba({
      nba,
      nlu: makeNlu('DISPUTE'),
      strategy: makeStrategy(),
      offersCount: 2,
    });

    expect(res.nba.action).toBe('FALLBACK_MENU');
    expect(res.enforcement).toBeUndefined();
  });
});
