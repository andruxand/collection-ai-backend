import { type VerifierView, VerifierViewSchema } from '@/core/conversation/domain/agentViews';
import { fillPrompt, loadPromptComposed } from '@/core/conversation/infra/promptLoader';
import type { MultiAgentMemoryTurn } from '../types';
import {
  type ClassifierOutput,
  type PlannerOutput,
  type VerifierOutput,
  type WriterOutput,
  VERIFIER_JSON_SCHEMA,
  VerifierOutputSchema,
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

function inferModeFromVerifierView(view: VerifierView): string {
  const fromClassifier = (view.classifier as Record<string, unknown>)?.['mode'];
  if (typeof fromClassifier === 'string' && fromClassifier.length > 0) return fromClassifier;
  return 'NEGOTIATION';
}

function containsDebtDetails(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes('$') || t.includes('cop')) return true;
  if (/(saldo|deuda|mora|vencid|cuota|total\s+deb|valor\s+a\s+pagar)/i.test(text)) return true;
  // Long digit sequences or common money formatting
  if (/\b\d{1,3}([\.,\s]\d{3})+\b/.test(text)) return true;
  return false;
}

export function deterministicModeGuard(params: {
  mode: string;
  writer: unknown;
  curatedPolicySnapshot?: unknown;
}): VerifierOutput | undefined {
  const curated = params.curatedPolicySnapshot as { complianceNotes?: unknown } | undefined;
  const complianceNotes = Array.isArray(curated?.complianceNotes)
    ? (curated?.complianceNotes as unknown[]).filter((x) => typeof x === 'string')
    : [];

  const writer = params.writer as Record<string, unknown>;
  const messageText = typeof writer?.['messageText'] === 'string' ? writer['messageText'] : '';
  if (!messageText) return undefined;

  // Curated compliance notes: enforce a few deterministic blocks.
  if (complianceNotes.includes('NO_LEGAL_THREATS')) {
    if (
      /(demanda|demandar|embargo|cobro\s+jur[ií]dic|proceso\s+judicial|c[aá]rcel)/i.test(
        messageText
      )
    ) {
      return {
        status: 'FAIL',
        issues: ['POLICY_VIOLATION'],
        repairInstructions:
          'Política: elimina amenazas o referencias a acciones legales/embargo/cárcel. Mantén un tono neutral y ofrece pasos de pago o escalamiento humano si aplica.',
      };
    }
  }

  if (params.mode === 'WRONG_PERSON') {
    if (containsDebtDetails(messageText)) {
      return {
        status: 'FAIL',
        issues: ['POLICY_VIOLATION'],
        repairInstructions:
          'Modo WRONG_PERSON: elimina cualquier detalle de deuda (monto/saldo/mora). Pide confirmación mínima de número equivocado y ofrece detener contactos.',
      };
    }
  }

  return undefined;
}

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return 'null';
  }
}

export class VerifierAgent {
  static async runWithView(params: {
    view: VerifierView;
    maxAttempts: number;
  }): Promise<
    | { ok: true; value: VerifierOutput; attempts: number; rawHistory: unknown[] }
    | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
  > {
    const view = VerifierViewSchema.parse(params.view);

    const mode = inferModeFromVerifierView(view);
    const deterministic = deterministicModeGuard({
      mode,
      writer: view.writer,
      curatedPolicySnapshot: (view as unknown as Record<string, unknown>)['curatedPolicySnapshot'],
    });
    if (deterministic) {
      return { ok: true, value: deterministic, attempts: 0, rawHistory: [] };
    }

    const template = loadPromptComposed('verifier.prompt.md', [
      `verifier.mode.${modeToSlug(mode)}.md`,
    ]);
    const prompt = fillPrompt(template, { viewJson: safeJsonStringify(view) });

    const res = await runStrictJsonAgent<VerifierOutput>({
      name: 'verifier',
      prompt,
      jsonSchema: VERIFIER_JSON_SCHEMA,
      zodSchema: VerifierOutputSchema,
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
    classifier: ClassifierOutput;
    plan: PlannerOutput;
    writer: WriterOutput;
    recentTurns: MultiAgentMemoryTurn[];
    curatedPolicySnapshot?: unknown;
    maxAttempts: number;
  }): Promise<
    | { ok: true; value: VerifierOutput; attempts: number; rawHistory: unknown[] }
    | { ok: false; attempts: number; error: string; rawHistory: unknown[] }
  > {
    const view = {
      classifier: params.classifier,
      mode: params.classifier.mode,
      plan: params.plan,
      writer: params.writer,
      lastTurns: params.recentTurns.slice(-10),
      policyHardRules: { noThreats: true, noHallucinations: true, noSensitivePii: true },
      curatedPolicySnapshot: params.curatedPolicySnapshot,
    };

    const deterministic = deterministicModeGuard({
      mode: params.classifier.mode,
      writer: params.writer,
      curatedPolicySnapshot: params.curatedPolicySnapshot,
    });
    if (deterministic) {
      return { ok: true, value: deterministic, attempts: 0, rawHistory: [] };
    }

    const template = loadPromptComposed('verifier.prompt.md', [
      `verifier.mode.${modeToSlug(params.classifier.mode)}.md`,
    ]);
    const prompt = fillPrompt(template, { viewJson: safeJsonStringify(view) });

    const res = await runStrictJsonAgent<VerifierOutput>({
      name: 'verifier',
      prompt,
      jsonSchema: VERIFIER_JSON_SCHEMA,
      zodSchema: VerifierOutputSchema,
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
