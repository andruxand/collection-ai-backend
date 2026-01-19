import { describe, expect, it } from 'vitest';

import {
  preferReengageFromClassifier,
  sanitizeEntities,
  textSuggestsWrongPerson,
} from '../../../../src/core/conversation/agentHelpers';

describe('agentHelpers', () => {
  it('detects wrong person phrases', () => {
    expect(textSuggestsWrongPerson('No soy la persona')).toBe(true);
    expect(textSuggestsWrongPerson('Buen día, ¿qué tal?')).toBe(false);
  });

  it('sanitizes entities when no evidence', () => {
    const res = sanitizeEntities({
      userTextRaw: 'Quiero un desayuno',
      entities: { amountCop: 50000, paymentMethod: 'CASH' },
    });
    expect(res['amountCop']).toBeNull();
    expect(res['paymentMethod']).toBeNull();
  });

  it('sanitizes date from natural language', () => {
    const res = sanitizeEntities({ userTextRaw: 'Mañana', entities: {} });
    expect(res['dateIso']).not.toBeNull();
  });

  it('prefers reengage when lowContext and off-topic', () => {
    const pref = preferReengageFromClassifier({ intent: 'OFF_TOPIC', flags: { lowContext: true } });
    expect(pref).toBe('negotiation.reengage');
    expect(
      preferReengageFromClassifier({ intent: 'PAY_LATER', flags: { lowContext: false } })
    ).toBeNull();
  });
});
