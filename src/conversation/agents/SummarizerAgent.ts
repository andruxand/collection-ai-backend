import { llmJson } from '../../core/llm/llmClient';
import type { SummarizerView } from '../domain/agentViews';
import type { SummaryMemory } from '../domain/contextPackV1';
import { SummaryMemorySchema } from '../domain/contextPackV1';
import { fillPrompt, loadPrompt } from '../infra/promptLoader';

export const SUMMARY_MEMORY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bullets', 'updatedAtIso', 'updatedAtTurnCount'],
  properties: {
    bullets: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    updatedAtIso: { type: 'string' },
    updatedAtTurnCount: { type: 'integer', minimum: 0 },
  },
};

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '{}';
  }
}

export async function runSummarizer(params: {
  view: SummarizerView;
  maxAttempts: number;
}): Promise<
  | { ok: true; value: SummaryMemory; rawHistory: unknown[] }
  | { ok: false; error: string; rawHistory: unknown[] }
> {
  const rawHistory: unknown[] = [];
  const template = loadPrompt('summarizer.prompt.md');

  let prompt = fillPrompt(template, { viewJson: safeStringify(params.view) });

  for (let attempt = 1; attempt <= Math.max(1, params.maxAttempts); attempt += 1) {
    let raw: unknown;
    try {
      raw = await llmJson(prompt, SUMMARY_MEMORY_JSON_SCHEMA, 'summarizer');
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'llmJson failed',
        rawHistory,
      };
    }

    rawHistory.push(raw);

    const parsed = SummaryMemorySchema.safeParse(raw);
    if (parsed.success) return { ok: true, value: parsed.data, rawHistory };

    const repairTpl = loadPrompt('json-repair.prompt.md');
    prompt = fillPrompt(repairTpl, {
      name: 'summarizer',
      schemaErrors: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n'),
      lastRaw: safeStringify(raw),
      originalPrompt: fillPrompt(template, { viewJson: safeStringify(params.view) }),
    });
  }

  return { ok: false, error: 'Max repair attempts reached', rawHistory };
}
