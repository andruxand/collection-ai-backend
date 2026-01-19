import type { WriterOutput } from '../../core/conversation/schemas';
import { WRITER_JSON_SCHEMA, WriterOutputSchema } from '../../core/conversation/schemas';
import { runStrictJsonAgent } from '../../core/conversation/strictJsonAgentRunner';
import type { WriterView } from '../domain/agentViews';
import { fillPrompt, loadPrompt } from '../infra/promptLoader';

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '{}';
  }
}

export async function runRepairAgent(params: {
  view: WriterView;
  repairInstructions: string;
  previousMessageText: string;
  maxAttempts: number;
}): Promise<
  | { ok: true; value: WriterOutput; attempts: number; rawHistory: unknown[] }
  | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
> {
  const template = loadPrompt('repair.prompt.md');
  const prompt = fillPrompt(template, {
    viewJson: safeStringify(params.view),
    repairInstructions: params.repairInstructions.slice(0, 600),
    previousMessageText: params.previousMessageText.slice(0, 800),
  });

  const res = await runStrictJsonAgent<WriterOutput>({
    name: 'repair',
    prompt,
    jsonSchema: WRITER_JSON_SCHEMA,
    zodSchema: WriterOutputSchema,
    maxAttempts: params.maxAttempts,
  });

  if (!res.ok) {
    return {
      ok: false,
      attempts: res.attempts,
      error: res.error.message,
      rawHistory: res.rawHistory,
    };
  }

  return { ok: true, value: res.value, attempts: res.attempts, rawHistory: res.rawHistory };
}
