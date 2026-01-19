import { describe, expect, it } from 'vitest';

import { parseNaturalDate } from '../../../../src/core/conversation/nlDateParser';

describe('nlDateParser', () => {
  it('parses hoy', () => {
    const res = parseNaturalDate('Hoy');
    expect(res.dateIso).not.toBeNull();
    expect(res.confidence).toBeGreaterThan(0.9);
  });

  it('parses manana', () => {
    const ref = new Date().toISOString().slice(0, 10);
    const res = parseNaturalDate('mañana', ref);
    expect(res.dateIso).not.toBeNull();
  });

  it('parses el 25 (day only) to next occurrence', () => {
    const res = parseNaturalDate('el 25');
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('parses dd/mm format', () => {
    const res = parseNaturalDate('25/12');
    expect(res.dateIso).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
