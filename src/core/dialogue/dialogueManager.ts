import { llmJson } from '../llm/llmClient';
import type { Offer } from '../offers/offerEngine';
import type { ConversationState, DebtorSnapshot, NbaDecision, NluResult, Tenant } from '../types';
import { buildDialoguePrompt } from './prompt';
import { DIALOGUE_JSON_SCHEMA, DialogueDecision, DialogueDecisionSchema } from './schema';

function sanitizeSlotsUpdate(slotsUpdate: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([
    'promiseDate',
    'promiseAmount',
    'paymentMethod',
    'selectedOfferId',
    'refusalCount',
    'refusedPay',
    'optedOut',
  ]);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(slotsUpdate ?? {})) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

function fillCooldownIfNeeded(decision: DialogueDecision, tenant: Tenant): DialogueDecision {
  const rejectedDays = tenant.policy.cooldowns.rejectedOfferDays;

  if (decision.nba.action === 'COOLDOWN' || decision.nba.action === 'END_REFUSAL') {
    const next = new Date(Date.now() + rejectedDays * 24 * 60 * 60 * 1000).toISOString();
    return {
      ...decision,
      nba: {
        ...decision.nba,
        nextContactAllowedAt: next,
      } as any,
    };
  }

  return decision;
}

function coerceToDomainTypes(decision: DialogueDecision): {
  nlu: NluResult;
  nba: NbaDecision;
  messageDraft?: string;
  confidence: number;
  rationale?: string;
} {
  const nlu = decision.nlu as NluResult;

  const nba = {
    ...decision.nba,
    slotsUpdate: sanitizeSlotsUpdate((decision.nba as any).slotsUpdate ?? {}),
  } as unknown as NbaDecision;

  return {
    nlu,
    nba,
    messageDraft: decision.messageDraft,
    confidence: decision.confidence ?? 0.6,
    rationale: decision.rationale,
  };
}

export async function decideWithDialogueManager(input: {
  tenant: Tenant;
  debtor: DebtorSnapshot;
  conversation: ConversationState;
  userText: string;
  offers: Offer[];
}): Promise<
  | {
      decision: DialogueDecision;
      nlu: NluResult;
      nba: NbaDecision;
      messageDraft?: string;
      confidence: number;
      rationale?: string;
      raw: unknown;
    }
  | undefined
> {
  const prompt = buildDialoguePrompt(input);

  try {
    const raw = await llmJson(prompt, DIALOGUE_JSON_SCHEMA, 'dialogue');
    const parsed = DialogueDecisionSchema.safeParse(raw);
    if (!parsed.success) return undefined;

    const withCooldown = fillCooldownIfNeeded(parsed.data, input.tenant);

    const coerced = coerceToDomainTypes(withCooldown);
    return {
      decision: withCooldown,
      raw,
      ...coerced,
    };
  } catch {
    return undefined;
  }
}

// Test helper: validate a raw object without calling any LLM.
export function validateDialogueDecision(raw: unknown): DialogueDecision | undefined {
  const parsed = DialogueDecisionSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
