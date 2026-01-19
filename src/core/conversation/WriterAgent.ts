import { type WriterView, WriterViewSchema } from '../../conversation/domain/agentViews';
import { fillPrompt, loadPromptComposed } from '../../conversation/infra/promptLoader';
import type { MultiAgentMemoryTurn, Tenant } from '../types';
import {
  type ClassifierOutput,
  type PlannerOutput,
  type WriterOutput,
  WRITER_JSON_SCHEMA,
  WriterOutputSchema,
} from './schemas';
import { runStrictJsonAgent } from './strictJsonAgentRunner';

function modeToSlug(mode: unknown): string {
  const m = String(mode ?? '').toUpperCase();
  if (m === 'NEGOTIATION') return 'negotiation';
  if (m === 'DISPUTE') return 'dispute';
  if (m === 'WRONG_PERSON') return 'wrong_person';
  if (m === 'ABUSE_DEESCALATION') return 'abuse_deescalation';
  if (m === 'HUMAN_HANDOFF') return 'human_handoff';
  return 'negotiation';
}

function inferModeFromWriterView(view: WriterView): string {
  const fromClassifier = (view.classifier as Record<string, unknown>)?.['mode'];
  if (typeof fromClassifier === 'string' && fromClassifier.length > 0) return fromClassifier;
  return 'NEGOTIATION';
}

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return 'null';
  }
}

export class WriterAgent {
  static async runWithView(params: {
    view: WriterView;
    maxAttempts: number;
  }): Promise<
    | { ok: true; value: WriterOutput; attempts: number; rawHistory: unknown[] }
    | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
  > {
    const view = WriterViewSchema.parse(params.view);

    const mode = inferModeFromWriterView(view);
    const template = loadPromptComposed('writer.prompt.md', [`writer.mode.${modeToSlug(mode)}.md`]);
    const prompt = fillPrompt(template, { viewJson: safeJsonStringify(view) });

    const res = await runStrictJsonAgent<WriterOutput>({
      name: 'writer',
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

  static async run(params: {
    tenant: Pick<Tenant, 'tenantId' | 'policy' | 'name'>;
    userText: string;
    classifier: ClassifierOutput;
    plan: PlannerOutput;
    recentTurns: MultiAgentMemoryTurn[];
    offersText?: string;
    repairInstructions?: string;
    previousMessageText?: string;
    variantKey?: 'A' | 'B';
    maxAttempts: number;
  }): Promise<
    | { ok: true; value: WriterOutput; attempts: number; rawHistory: unknown[] }
    | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
  > {
    const view = {
      tenant: { tenantId: params.tenant.tenantId, name: params.tenant.name },
      tonePolicy: params.tenant.policy.tonePolicy,
      classifier: params.classifier,
      mode: params.classifier.mode,
      plan: params.plan,
      offersText: params.offersText ? params.offersText.slice(0, 900) : undefined,
      lastTurns: params.recentTurns.slice(-10),
      input: { userTextRaw: params.userText },
      repairInstructions: params.repairInstructions,
      previousMessageText: params.previousMessageText,
      variantKey: params.variantKey,
    };

    const template = loadPromptComposed('writer.prompt.md', [
      `writer.mode.${modeToSlug(params.classifier.mode)}.md`,
    ]);
    const prompt = fillPrompt(template, { viewJson: safeJsonStringify(view) });

    const res = await runStrictJsonAgent<WriterOutput>({
      name: 'writer',
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
}
