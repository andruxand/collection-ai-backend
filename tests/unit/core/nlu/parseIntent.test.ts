import { describe, expect, it, vi } from 'vitest';

import type { ConversationState } from '@/core/types';

const llmJson = vi.fn();

vi.mock('@/core/llm/llmClient', () => ({
  llmJson: (...args: unknown[]) => llmJson(...args),
}));

import { parseIntent } from '@/core/nlu/parseIntent';

describe('parseIntent (deterministic menu)', () => {
  it('maps "hola" to GREETING', async () => {
    const res = await parseIntent({ text: 'hola' });
    expect(res.intent).toBe('GREETING');
  });

  it('maps "/start" to GREETING', async () => {
    const res = await parseIntent({ text: '/start' });
    expect(res.intent).toBe('GREETING');
  });

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

  it('maps "1" to SELECT_OFFER when in OFFER_MENU', async () => {
    const conversation: ConversationState = { state: 'OFFER_MENU', slots: {}, attemptCount: 1 };
    const res = await parseIntent({ text: '1', conversation });
    expect(res.intent).toBe('SELECT_OFFER');
    expect(res.entities.offerIndex).toBe(1);
  });

  it('maps "sí" to AFFIRM', async () => {
    const res = await parseIntent({ text: 'sí' });
    expect(res.intent).toBe('AFFIRM');
  });

  it('maps "no quiero pagar" to REFUSE_PAY', async () => {
    const res = await parseIntent({ text: 'no quiero pagar' });
    expect(res.intent).toBe('REFUSE_PAY');
  });
});
