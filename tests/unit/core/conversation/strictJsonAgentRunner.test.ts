import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import { runStrictJsonAgent } from '@/core/conversation/strictJsonAgentRunner';

const llmJson = vi.fn();

vi.mock('@/core/llm/llmClient', () => ({
  llmJson: (...args: unknown[]) => llmJson(...args),
}));

describe('runStrictJsonAgent', () => {
  test('repairs invalid output and succeeds', async () => {
    const schema = z
      .object({
        a: z.number().int(),
      })
      .strict();

    (llmJson as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ a: 'nope' })
      .mockResolvedValueOnce({ a: 123 });

    const res = await runStrictJsonAgent<{ a: number }>({
      name: 't',
      prompt: 'x',
      jsonSchema: { type: 'object' },
      zodSchema: schema,
      maxAttempts: 2,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.a).toBe(123);
    expect(res.attempts).toBe(2);
    expect(res.rawHistory).toHaveLength(2);
  });
});
