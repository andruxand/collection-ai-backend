import { fillPrompt, loadPromptComposed } from '../../conversation/infra/promptLoader';
import { type EvaluatorOutput, EVALUATOR_JSON_SCHEMA, EvaluatorOutputSchema } from './schemas';
import { runStrictJsonAgent } from './strictJsonAgentRunner';

export type EvaluatorView = {
  mode: string;
  plan: Record<string, unknown>;
  classifier: Record<string, unknown>;
  variants: {
    A: { messageText: string };
    B: { messageText: string };
  };
  tenantHints?: {
    preferShortMessages?: boolean;
    maxMessageChars?: number;
  };
};

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return 'null';
  }
}

function modeToSlug(mode: unknown): string {
  const m = String(mode ?? '').toUpperCase();
  if (m === 'NEGOTIATION') return 'negotiation';
  if (m === 'DISPUTE') return 'dispute';
  if (m === 'WRONG_PERSON') return 'wrong_person';
  if (m === 'ABUSE_DEESCALATION') return 'abuse_deescalation';
  if (m === 'HUMAN_HANDOFF') return 'human_handoff';
  return 'negotiation';
}

export class EvaluatorAgent {
  static async run(params: {
    view: EvaluatorView;
    maxAttempts: number;
  }): Promise<
    | { ok: true; value: EvaluatorOutput; attempts: number; rawHistory: unknown[] }
    | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
  > {
    const mode = params.view.mode;
    const template = loadPromptComposed('evaluator.prompt.md', [
      `evaluator.mode.${modeToSlug(mode)}.md`,
    ]);
    const prompt = fillPrompt(template, { viewJson: safeJsonStringify(params.view) });

    const res = await runStrictJsonAgent<EvaluatorOutput>({
      name: 'evaluator',
      prompt,
      jsonSchema: EVALUATOR_JSON_SCHEMA,
      zodSchema: EvaluatorOutputSchema,
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
}
