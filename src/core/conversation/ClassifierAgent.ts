import { type ClassifierView, ClassifierViewSchema } from '@/core/conversation/domain/agentViews';
import { fillPrompt, loadPrompt } from '@/core/conversation/infra/promptLoader';
import type { DebtorSnapshot, MultiAgentMemoryTurn, TenantPolicy } from '../types';
import { sanitizeEntities, textSuggestsWrongPerson, textSuggestsPayNow } from './agentHelpers';
import { type ClassifierOutput, CLASSIFIER_JSON_SCHEMA, ClassifierOutputSchema } from './schemas';
import { runStrictJsonAgent } from './strictJsonAgentRunner';

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return 'null';
 
  }
}

// sanitizer and wrong-person detection moved to agentHelpers

function postProcessClassifier(params: {
  userTextRaw: string;
  output: ClassifierOutput;
}): ClassifierOutput {
  const userTextRaw = params.userTextRaw;
  const out: ClassifierOutput = {
    ...params.output,
    entities: sanitizeEntities({
      userTextRaw,
      entities: params.output.entities as unknown as Record<string, unknown>,
    }),
  };

  // If the model routed to WRONG_PERSON without explicit evidence, treat as off-topic + low context
  // and steer back to the collection objective.
  if (out.mode === 'WRONG_PERSON' && !textSuggestsWrongPerson(userTextRaw)) {
    out.mode = 'NEGOTIATION';
    if (out.intent === 'WRONG_PERSON') out.intent = 'OFF_TOPIC';
    out.flags = { ...out.flags, lowContext: true };
    out.modeRationale =
      (out.modeRationale ?? '').slice(0, 120) ||
      'Mensaje sin evidencia de persona equivocada; se redirige.';
  }

  // If user clearly wants to pay now, normalize intent to PAY_NOW and set date to today if missing.
  if (textSuggestsPayNow(userTextRaw)) {
    out.mode = 'NEGOTIATION';
    out.intent = 'PAY_NOW';
    const hasDate = typeof (out.entities as any)?.dateIso === 'string' && (out.entities as any).dateIso.length > 0;
    if (!hasDate) {
      const today = new Date().toISOString().slice(0, 10);
      (out.entities as any).dateIso = today;
    }
    out.flags = { ...(out.flags ?? {}), lowContext: false, ambiguousDate: false };
    out.rationale = (out.rationale ?? '').slice(0, 180) || 'Usuario expresa intención de pagar hoy; se enruta a PAY_NOW.';
  }

  return out;
}

export class ClassifierAgent {
  static async runWithView(params: {
    view: ClassifierView;
    maxAttempts: number;
  }): Promise<
    | { ok: true; value: ClassifierOutput; attempts: number; rawHistory: unknown[] }
    | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
  > {
    const view = ClassifierViewSchema.parse(params.view);

    const template = loadPrompt('classifier.prompt.md');
    const prompt = fillPrompt(template, { viewJson: safeJsonStringify(view) });

    const res = await runStrictJsonAgent<ClassifierOutput>({
      name: 'classifier',
      prompt,
      jsonSchema: CLASSIFIER_JSON_SCHEMA,
      zodSchema: ClassifierOutputSchema,
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

    return {
      ok: true,
      value: postProcessClassifier({
        userTextRaw: String((view.input as Record<string, unknown>)?.['userTextRaw'] ?? ''),
        output: res.value,
      }),
      attempts: res.attempts,
      rawHistory: res.rawHistory,
    };
  }

  static async run(params: {
    userText: string;
    debtor: Pick<DebtorSnapshot, 'totalDueCop' | 'daysPastDue' | 'stage'>;
    tenantPolicy: Pick<TenantPolicy, 'handoffPolicy' | 'auditPolicy' | 'tonePolicy'>;
    conversationState: string;
    recentTurns: MultiAgentMemoryTurn[];
    maxAttempts: number;
  }): Promise<
    | { ok: true; value: ClassifierOutput; attempts: number; rawHistory: unknown[] }
    | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
  > {
    const view = {
      meta: {
        conversationState: params.conversationState,
      },
      tonePolicy: params.tenantPolicy.tonePolicy,
      lastTurns: params.recentTurns.slice(-10),
      input: {
        userTextRaw: params.userText,
        debtor: params.debtor,
      },
      tenantHints: {
        handoffEnabled: params.tenantPolicy.handoffPolicy?.enabled ?? false,
      },
    };

    const template = loadPrompt('classifier.prompt.md');
    const prompt = fillPrompt(template, { viewJson: safeJsonStringify(view) });

    const res = await runStrictJsonAgent<ClassifierOutput>({
      name: 'classifier',
      prompt,
      jsonSchema: CLASSIFIER_JSON_SCHEMA,
      zodSchema: ClassifierOutputSchema,
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

    return {
      ok: true,
      value: postProcessClassifier({ userTextRaw: params.userText, output: res.value }),
      attempts: res.attempts,
      rawHistory: res.rawHistory,
    };
  }
}
