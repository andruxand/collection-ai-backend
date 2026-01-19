import type { z } from 'zod';

import { fillPrompt, loadPrompt } from '../../conversation/infra/promptLoader';
import { llmJson } from '../llm/llmClient';

export type StrictJsonAgentResult<T> =
  | {
      ok: true;
      value: T;
      attempts: number;
      raw: unknown;
      rawHistory: unknown[];
    }
  | {
      ok: false;
      attempts: number;
      lastRaw: unknown;
      rawHistory: unknown[];
      error: { message: string };
    };

function formatZodIssues(err: z.ZodError): string {
  const issues = err.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  return issues || '- (unknown schema error)';
}

function buildRepairPrompt(params: {
  originalPrompt: string;
  name: string;
  schemaErrors: string;
  lastRaw: unknown;
}): string {
  const template = loadPrompt('json-repair.prompt.md');
  return fillPrompt(template, {
    name: params.name,
    schemaErrors: params.schemaErrors,
    lastRaw: JSON.stringify(params.lastRaw),
    originalPrompt: params.originalPrompt,
  });
}

export async function runStrictJsonAgent<T>(params: {
  name: string;
  prompt: string;
  jsonSchema: unknown;
  zodSchema: z.ZodType<T, z.ZodTypeDef, unknown>;
  maxAttempts: number;
}): Promise<StrictJsonAgentResult<T>> {
  const rawHistory: unknown[] = [];

  let currentPrompt = params.prompt;
  for (let attempt = 1; attempt <= Math.max(1, params.maxAttempts); attempt += 1) {
    let raw: unknown;
    try {
      raw = await llmJson(currentPrompt, params.jsonSchema, params.name);
    } catch (err: unknown) {
      return {
        ok: false,
        attempts: attempt,
        lastRaw: undefined,
        rawHistory,
        error: { message: err instanceof Error ? err.message : 'llmJson failed' },
      };
    }

    rawHistory.push(raw);

    const parsed = params.zodSchema.safeParse(raw);
    if (parsed.success) {
      return {
        ok: true,
        value: parsed.data,
        attempts: attempt,
        raw,
        rawHistory,
      };
    }

    const schemaErrors = formatZodIssues(parsed.error);
    currentPrompt = buildRepairPrompt({
      originalPrompt: params.prompt,
      name: params.name,
      schemaErrors,
      lastRaw: raw,
    });
  }

  return {
    ok: false,
    attempts: Math.max(1, params.maxAttempts),
    lastRaw: rawHistory[rawHistory.length - 1],
    rawHistory,
    error: { message: 'Max repair attempts reached' },
  };
}
