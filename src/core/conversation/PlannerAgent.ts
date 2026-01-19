import { type PlannerView, PlannerViewSchema } from '../../conversation/domain/agentViews';
import { fillPrompt, loadPromptComposed } from '../../conversation/infra/promptLoader';
import type { MultiAgentBudgetsSnapshot, MultiAgentMemoryTurn } from '../types';
import {
  type ClassifierOutput,
  type PlannerOutput,
  PLANNER_JSON_SCHEMA,
  PlannerOutputSchema,
} from './schemas';
import { runStrictJsonAgent } from './strictJsonAgentRunner';

function normalizeMode(mode: unknown): string {
  return String(mode ?? 'NEGOTIATION').toUpperCase();
}

function enforceModePlan(params: {
  mode: unknown;
  plan: PlannerOutput;
  budgets: MultiAgentBudgetsSnapshot;
  handoffEnabled?: boolean;
}): PlannerOutput {
  const mode = normalizeMode(params.mode);

  if (mode === 'HUMAN_HANDOFF') {
    return {
      ...params.plan,
      actionType: 'ESCALATE',
      targetSlot: undefined,
      options: undefined,
      summaryToConfirm: undefined,
      question:
        params.plan.question ??
        'Te pondré en contacto con un asesor humano para ayudarte. ¿Hay algún horario preferido para contactarte?',
      complianceNotes: [...(params.plan.complianceNotes ?? []), 'MODE_OVERRIDE:HUMAN_HANDOFF'],
    };
  }

  if (mode === 'WRONG_PERSON') {
    return {
      ...params.plan,
      actionType: 'INFORM_TEMPLATE',
      templateId: 'wrong_person.safe_exit',
      templateVars: undefined,
      targetSlot: undefined,
      options: undefined,
      summaryToConfirm: undefined,
      question: undefined,
      complianceNotes: [...(params.plan.complianceNotes ?? []), 'MODE_OVERRIDE:WRONG_PERSON'],
    };
  }

  if (mode === 'DISPUTE') {
    // In dispute mode, avoid negotiation-style offers/confirmations.
    if (params.plan.actionType === 'OFFER_OPTIONS' || params.plan.actionType === 'CONFIRM') {
      return {
        ...params.plan,
        actionType: 'ASK_SLOT',
        targetSlot: 'identityConfirmed',
        options: undefined,
        summaryToConfirm: undefined,
        question:
          params.plan.question ??
          'Entiendo. Para revisarlo, ¿confirmas si eres el titular o el autorizado?',
        complianceNotes: [...(params.plan.complianceNotes ?? []), 'MODE_OVERRIDE:DISPUTE'],
      };
    }
    return params.plan;
  }

  if (mode === 'ABUSE_DEESCALATION') {
    const strikes = params.budgets.counters.abuseStrikes;
    const limit = params.budgets.abuseStrikeLimit;
    const shouldEnd = strikes >= limit;

    if (
      shouldEnd ||
      params.plan.actionType === 'OFFER_OPTIONS' ||
      params.plan.actionType === 'CONFIRM'
    ) {
      return {
        ...params.plan,
        actionType: shouldEnd ? 'END' : 'INFORM',
        targetSlot: undefined,
        options: undefined,
        summaryToConfirm: undefined,
        question: shouldEnd
          ? undefined
          : params.plan.question ??
            'Puedo ayudarte con el pago, pero necesito que mantengamos un tono respetuoso. ¿Prefieres pagar hoy o acordar una fecha?',
        complianceNotes: [
          ...(params.plan.complianceNotes ?? []),
          'MODE_OVERRIDE:ABUSE_DEESCALATION',
        ],
      };
    }

    return params.plan;
  }

  return params.plan;
}

function shouldPreferTemplate(params: {
  intent: string;
  mode: unknown;
  flags: Record<string, unknown> | undefined;
  negotiationRounds: number;
  budgets?: { counters?: { offTopicRedirects?: number }; maxOffTopicRedirects?: number };
}): { templateId: string } | null {
  const mode = normalizeMode(params.mode);
  const intent = String(params.intent ?? '').toUpperCase();
  const flags = params.flags ?? {};

  if (flags['ambiguousAmount'] === true) return null;
  if (flags['ambiguousDate'] === true) return null;
  if (flags['contradiction'] === true) return null;
  if (params.negotiationRounds >= 2) return null;

  if (mode === 'WRONG_PERSON' || intent === 'WRONG_PERSON') {
    return { templateId: 'wrong_person.safe_exit' };
  }

  if (mode === 'ABUSE_DEESCALATION' || intent === 'ABUSIVE') {
    return { templateId: 'abuse.boundary_warning' };
  }

  if (intent === 'INFO_REQUEST') {
    return { templateId: 'info.how_to_pay' };
  }

  // User indicates desire to pay now (e.g., "quiero pagar hoy/ahora").
  if (intent === 'PAY_NOW') {
    return { templateId: 'negotiation.pay_now' };
  }

  // When the user message is casual/off-topic and we lack context, deterministically steer back
  // to the goal instead of burning repair attempts downstream.
  if (flags['lowContext'] === true && (intent === 'OFF_TOPIC' || intent === 'UNKNOWN')) {
    const off = Number(params.budgets?.counters?.offTopicRedirects ?? 0);
    const limit = Number(params.budgets?.maxOffTopicRedirects ?? 2);
    if (off > limit) return { templateId: 'negotiation.polite_close' };
    if (off >= limit) return { templateId: 'negotiation.final_warning' };
    return { templateId: 'negotiation.reengage' };
  }

  return null;
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

function inferModeFromPlannerView(view: PlannerView): string {
  const fromClassifier = (view.classifier as Record<string, unknown>)?.['mode'];
  if (typeof fromClassifier === 'string' && fromClassifier.length > 0) return fromClassifier;

  const wm = view.pack.workingMemory as Record<string, unknown>;
  const state = (wm?.['state'] as Record<string, unknown> | undefined) ?? undefined;
  const fromMemory = state?.['mode'];
  if (typeof fromMemory === 'string' && fromMemory.length > 0) return fromMemory;

  return 'NEGOTIATION';
}

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return 'null';
  }
}

export class PlannerAgent {
  static async runWithView(params: {
    view: PlannerView;
    maxAttempts: number;
  }): Promise<
    | { ok: true; value: PlannerOutput; attempts: number; rawHistory: unknown[] }
    | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
  > {
    const view = PlannerViewSchema.parse(params.view);

    const mode = inferModeFromPlannerView(view);
    const template = loadPromptComposed('planner.prompt.md', [
      `planner.mode.${modeToSlug(mode)}.md`,
    ]);
    const prompt = fillPrompt(template, { viewJson: safeJsonStringify(view) });

    const res = await runStrictJsonAgent<PlannerOutput>({
      name: 'planner',
      prompt,
      jsonSchema: PLANNER_JSON_SCHEMA,
      zodSchema: PlannerOutputSchema,
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

    const corrected = enforceModePlan({
      mode,
      plan: res.value,
      budgets: view.pack.budgetsRuntime as unknown as MultiAgentBudgetsSnapshot,
      handoffEnabled: view.pack.tenantConfig.handoffEnabled,
    });

    const prefer = shouldPreferTemplate({
      intent: String((view.classifier as Record<string, unknown>)?.['intent'] ?? ''),
      mode,
      flags: (view.classifier as Record<string, unknown>)?.['flags'] as
        | Record<string, unknown>
        | undefined,
      negotiationRounds: (view.pack.budgetsRuntime as unknown as MultiAgentBudgetsSnapshot).counters
        .negotiationRounds,
      budgets: {
        counters: {
          offTopicRedirects: (view.pack.budgetsRuntime as unknown as MultiAgentBudgetsSnapshot)
            .counters.offTopicRedirects,
        },
        maxOffTopicRedirects: (view.pack.budgetsRuntime as unknown as MultiAgentBudgetsSnapshot)
          .maxOffTopicRedirects,
      },
    });

    const allowTemplateOverride =
      corrected.actionType !== 'ESCALATE' && corrected.actionType !== 'END';
    if (prefer && allowTemplateOverride) {
      return {
        ok: true,
        value: {
          ...corrected,
          actionType: 'INFORM_TEMPLATE',
          templateId: prefer.templateId,
          templateVars: undefined,
          question: undefined,
          options: undefined,
          targetSlot: undefined,
          summaryToConfirm: undefined,
          complianceNotes: [...(corrected.complianceNotes ?? []), 'TEMPLATE_SELECTED'],
        },
        attempts: res.attempts,
        rawHistory: res.rawHistory,
      };
    }

    return { ok: true, value: corrected, attempts: res.attempts, rawHistory: res.rawHistory };
  }

  static async run(params: {
    classifier: ClassifierOutput;
    userText: string;
    conversationState: string;
    recentTurns: MultiAgentMemoryTurn[];
    budgets: MultiAgentBudgetsSnapshot;
    offersSummary?: { offersCount: number };
    maxAttempts: number;
  }): Promise<
    | { ok: true; value: PlannerOutput; attempts: number; rawHistory: unknown[] }
    | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
  > {
    const view = {
      conversationState: params.conversationState,
      classifier: params.classifier,
      mode: params.classifier.mode,
      budgets: params.budgets,
      offersSummary: params.offersSummary ?? { offersCount: 0 },
      lastTurns: params.recentTurns.slice(-10),
      input: { userTextRaw: params.userText },
    };

    const template = loadPromptComposed('planner.prompt.md', [
      `planner.mode.${modeToSlug(params.classifier.mode)}.md`,
    ]);
    const prompt = fillPrompt(template, { viewJson: safeJsonStringify(view) });

    const res = await runStrictJsonAgent<PlannerOutput>({
      name: 'planner',
      prompt,
      jsonSchema: PLANNER_JSON_SCHEMA,
      zodSchema: PlannerOutputSchema,
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

    const corrected = enforceModePlan({
      mode: params.classifier.mode,
      plan: res.value,
      budgets: params.budgets,
    });

    const prefer = shouldPreferTemplate({
      intent: params.classifier.intent,
      mode: params.classifier.mode,
      flags: params.classifier.flags as unknown as Record<string, unknown>,
      negotiationRounds: params.budgets.counters.negotiationRounds,
      budgets: {
        counters: { offTopicRedirects: params.budgets.counters.offTopicRedirects },
        maxOffTopicRedirects: params.budgets.maxOffTopicRedirects,
      },
    });

    const allowTemplateOverride =
      corrected.actionType !== 'ESCALATE' && corrected.actionType !== 'END';
    if (prefer && allowTemplateOverride) {
      return {
        ok: true,
        value: {
          ...corrected,
          actionType: 'INFORM_TEMPLATE',
          templateId: prefer.templateId,
          templateVars: undefined,
          question: undefined,
          options: undefined,
          targetSlot: undefined,
          summaryToConfirm: undefined,
          complianceNotes: [...(res.value.complianceNotes ?? []), 'TEMPLATE_SELECTED'],
        },
        attempts: res.attempts,
        rawHistory: res.rawHistory,
      };
    }

    return { ok: true, value: corrected, attempts: res.attempts, rawHistory: res.rawHistory };
  }
}
