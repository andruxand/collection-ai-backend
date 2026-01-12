import { describe, expect, it, vi } from 'vitest';

vi.mock('../llm/llmClient', () => ({
  llmJson: vi.fn(async () => ({ intent: 'UNKNOWN', entities: {}, confidence: 0.2, topicShift: false })),
}));

import { parseIntent } from './parseIntent';

describe('parseIntent (deterministic menu)', () => {
  it('maps "1" to ASK_DETAIL', async () => {
    const res = await parseIntent({ text: '1' });
    expect(res.intent).toBe('ASK_DETAIL');
  });

  it('maps "2" to NEGOTIATE', async () => {
    const res = await parseIntent({ text: '2' });
    expect(res.intent).toBe('NEGOTIATE');
  });

  it('maps "3" to PAY_NOW', async () => {
    const res = await parseIntent({ text: '3' });
    expect(res.intent).toBe('PAY_NOW');
  });

  it('maps "4" to PROMISE_PAYMENT', async () => {
    const res = await parseIntent({ text: '4' });
    expect(res.intent).toBe('PROMISE_PAYMENT');
  });

  it('maps "ver detalle" to ASK_DETAIL', async () => {
    const res = await parseIntent({ text: 'ver detalle' });
    expect(res.intent).toBe('ASK_DETAIL');
  });
});
