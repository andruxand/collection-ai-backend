import { describe, expect, it, vi } from 'vitest';

import { parseIntent } from '../src/core/nlu/parseIntent';

describe('parseIntent (deterministic Spanish entities)', () => {
  it('extracts amount from "20 mil" in negotiation context', async () => {
    const res = await parseIntent({
      text: 'tengo 20 mil para pagar esta semana',
      conversation: { state: 'NEGOTIATION', slots: {}, attemptCount: 1 },
    });

    expect(res.intent).toBe('PROMISE_PAYMENT');
    expect(res.entities.amountCop).toBe(20_000);
  });

  it('extracts next weekday date from "pago el martes"', async () => {
    vi.useFakeTimers();
    // 2026-01-18 is Sunday. Next Tuesday should be 2026-01-20.
    vi.setSystemTime(new Date('2026-01-18T12:00:00.000Z'));

    const res = await parseIntent({
      text: 'pago el martes',
      conversation: { state: 'NEGOTIATION', slots: {}, attemptCount: 1 },
    });

    expect(res.intent).toBe('PROMISE_PAYMENT');
    expect(res.entities.dateIso).toBe('2026-01-20');

    vi.useRealTimers();
  });
});
