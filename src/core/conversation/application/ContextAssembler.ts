import { DateTime } from 'luxon';

import { CuratedPolicyTool } from '../../policy/curated/CuratedPolicyTool';
import type {
  ConversationState,
  DebtorSnapshot,
  MultiAgentBudgetsSnapshot,
  MultiAgentConversationState,
  MultiAgentMemoryTurn,
  Tenant,
} from '../../types';
import type { ContextPackV1 } from '../domain/contextPackV1';
import { redactTurns } from '../infra/pii';
import { selectLastTurnsCount } from './contextSelection';

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function parseAmountCandidate(text: string): { amountCop?: number; ambiguousAmount: boolean } {
  const matches = Array.from(text.matchAll(/\b\d{1,3}(?:[\.,\s]\d{3})+\b|\b\d{2,9}\b/g));
  const nums = matches
    .map((m) => m[0])
    .map((s) => s.replace(/\s/g, '').replace(/\./g, '').replace(/,/g, ''))
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);

  const unique = Array.from(new Set(nums));
  if (unique.length === 0) return { ambiguousAmount: false };
  if (unique.length > 1) return { ambiguousAmount: true };

  let amount = unique[0];
  if (/\bmil\b/i.test(text) && amount < 1000) amount *= 1000;
  if (/\bmill(?:o|ó)n(?:es)?\b/i.test(text) && amount < 1000000) amount *= 1000000;

  return { amountCop: Math.round(amount), ambiguousAmount: false };
}

function parseDateCandidate(
  text: string,
  atIso: string
): { dateIso?: string; ambiguousDate: boolean } {
  const lower = text.toLowerCase();
  const at = DateTime.fromISO(atIso, { zone: 'utc' });

  if (lower.includes('mañana')) {
    return { dateIso: at.plus({ days: 1 }).toISODate() as string, ambiguousDate: false };
  }

  const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return { dateIso: isoMatch[1], ambiguousDate: false };

  const dmMatch = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dmMatch) {
    const d = Number(dmMatch[1]);
    const m = Number(dmMatch[2]);
    const y = dmMatch[3]
      ? Number(dmMatch[3].length === 2 ? `20${dmMatch[3]}` : dmMatch[3])
      : at.year;
    const dt = DateTime.utc(y, m, d);
    if (dt.isValid) return { dateIso: dt.toISODate() as string, ambiguousDate: false };
  }

  // Very light Spanish month parsing: "20 de enero"
  const monthMap: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };

  const md = lower.match(/\b(\d{1,2})\s+de\s+([a-záéíóú]+)\b/);
  if (md) {
    const d = Number(md[1]);
    const m = monthMap[md[2]];
    if (m) {
      const y = at.year;
      const dt = DateTime.utc(y, m, d);
      if (dt.isValid) return { dateIso: dt.toISODate() as string, ambiguousDate: false };
    }
  }

  return { ambiguousDate: false };
}

function parsePaymentMethodCandidate(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes('pse')) return 'PSE';
  if (lower.includes('tarjeta') || lower.includes('card')) return 'CARD';
  if (lower.includes('transfer')) return 'TRANSFER';
  if (lower.includes('efectivo') || lower.includes('cash')) return 'CASH';
  return undefined;
}

function compactTurns(
  turns: MultiAgentMemoryTurn[]
): Array<{ role: 'user' | 'assistant'; atIso: string; text?: string }> {
  return turns
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .map((t) => ({
      role: t.role,
      atIso: t.atIso,
      text: t.text ? normalizeText(t.text).slice(0, 260) : undefined,
    }));
}

function capSummaryMemory(
  summary: MultiAgentConversationState['summaryMemory']
): MultiAgentConversationState['summaryMemory'] {
  if (!summary) return undefined;
  const bullets = (summary.bullets ?? [])
    .slice(0, 8)
    .map((b) => normalizeText(String(b)).slice(0, 160))
    .filter((b) => b.length > 0);

  return {
    bullets,
    updatedAtIso: summary.updatedAtIso,
    updatedAtTurnCount: summary.updatedAtTurnCount,
  };
}

export class ContextAssembler {
  static assembleV1(params: {
    tenant: Tenant;
    debtor: DebtorSnapshot;
    conversation: ConversationState;
    budgets: MultiAgentBudgetsSnapshot;
    turnId: string;
    atIso: string;
    channel: 'whatsapp' | 'telegram';
    userText: string;
  }): { pack: ContextPackV1; selectedTurnsCount: number; windowExceeded: boolean } {
    const policy = params.tenant.policy;
    const ma: MultiAgentConversationState | undefined = params.conversation.multiAgent;

    const defaultTurns = policy.conversationPolicy?.contextPackV1?.defaultLastTurns ?? 8;
    const selectedTurnsCount = selectLastTurnsCount({
      conversation: params.conversation,
      multiAgent: ma,
      defaultCount: defaultTurns,
    });

    const recentTurns = ma?.recentTurns ?? [];
    const windowExceeded = recentTurns.length > selectedTurnsCount;

    const lastTurnsRaw = compactTurns(recentTurns).slice(-Math.min(12, selectedTurnsCount));
    const lastTurns = redactTurns(lastTurnsRaw);

    const summaryMemory = capSummaryMemory(ma?.summaryMemory);

    const userTextRaw = params.userText.slice(0, 2000);
    const userTextNormalized = normalizeText(userTextRaw).slice(0, 1200);
    const amount = parseAmountCandidate(userTextNormalized);
    const date = parseDateCandidate(userTextNormalized, params.atIso);
    const paymentMethod = parsePaymentMethodCandidate(userTextNormalized);

    const countryCode = String(policy.contactPolicy.countryCode || 'CO').toUpperCase();
    const curated = CuratedPolicyTool.resolvePolicySnapshot({
      countryCode,
      policyVersion: policy.conversationPolicy?.curatedPolicy?.versionOverride,
    });

    const pack: ContextPackV1 = {
      meta: {
        version: 'ContextPack/v1',
        tenantId: params.tenant.tenantId,
        debtorId: params.debtor.debtorId,
        channel: params.channel,
        atIso: params.atIso,
        turnId: params.turnId,
        conversationState: params.conversation.state,
      },
      tenantConfig: {
        tonePolicy: policy.tonePolicy as unknown as Record<string, string>,
        handoffEnabled: policy.handoffPolicy?.enabled ?? false,
      },
      debtSnapshot: {
        totalDueCop: Math.max(0, Math.round(params.debtor.totalDueCop)),
        daysPastDue: Math.max(0, Math.round(params.debtor.daysPastDue)),
        stage: params.debtor.stage,
      },
      policySnapshot: {
        maxRepairAttempts:
          policy.conversationPolicy?.multiAgentOrchestration?.maxRepairAttempts ?? 2,
        budgets: {
          maxNegotiationRounds:
            policy.conversationPolicy?.multiAgentOrchestration?.budgets?.maxNegotiationRounds ?? 6,
          maxSlotAsksPerSlot:
            policy.conversationPolicy?.multiAgentOrchestration?.budgets?.maxSlotAsksPerSlot ?? 2,
          maxOffTopicRedirects:
            policy.conversationPolicy?.multiAgentOrchestration?.budgets?.maxOffTopicRedirects ?? 2,
          abuseStrikeLimit:
            policy.conversationPolicy?.multiAgentOrchestration?.budgets?.abuseStrikeLimit ?? 3,
        },
        curatedPolicy: curated.snapshot,
      },

      budgetsRuntime: params.budgets,
      workingMemory: (ma?.workingMemory ?? {}) as Record<string, unknown>,
      summaryMemory,
      lastTurns,
      input: {
        userTextRaw,
        userTextNormalized,
        candidates: {
          amountCop: amount.amountCop,
          dateIso: date.dateIso,
          paymentMethod,
          ambiguousAmount: amount.ambiguousAmount,
          ambiguousDate: date.ambiguousDate,
        },
      },
    };

    return { pack, selectedTurnsCount, windowExceeded };
  }
}
