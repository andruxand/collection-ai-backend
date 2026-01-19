/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable max-lines */
import { Logger } from '@aws-lambda-powertools/logger';
import crypto from 'crypto';
import { DateTime } from 'luxon';

import { runRepairAgent } from '@/core/conversation/agents/RepairAgent';
import { runSummarizer } from '@/core/conversation/agents/SummarizerAgent';
import { ContextAssembler } from '@/core/conversation/application/ContextAssembler';
import { shouldSummarize } from '@/core/conversation/application/contextSelection';
import type {
  ClassifierView,
  PlannerView,
  SummarizerView,
  VerifierView,
  WriterView,
} from '@/core/conversation/domain/agentViews';
import { type Offer, buildOffers } from '../offers/offerEngine';
import { CuratedPolicyTool } from '../policy/curated/CuratedPolicyTool';
import { putConversationTurnAudit } from '../store/repos';
import type {
  ConversationState,
  DebtorSnapshot,
  MultiAgentBudgetsSnapshot,
  MultiAgentConversationState,
  MultiAgentMemoryTurn,
  Tenant,
  TenantPolicy,
} from '../types';
import { ClassifierAgent } from './ClassifierAgent';
import { ConversationAgentV2 } from './ConversationAgentV2';
import { EvaluatorAgent } from './EvaluatorAgent';
import { parseNaturalDate } from './nlDateParser';
import { PlannerAgent } from './PlannerAgent';
import { type TemplateMode, TemplateLibrary } from './templates/TemplateLibrary';
import { deterministicModeGuard, VerifierAgent } from './VerifierAgent';
import { WriterAgent } from './WriterAgent';

function withModeInWorkingMemory(params: {
  workingMemory: Record<string, unknown> | undefined;
  mode: string;
  modeConfidence: number;
  modeRationale: string;
  turnCount: number;
}): Record<string, unknown> {
  const next = { ...(params.workingMemory ?? {}) };

  const existingState = next['state'];
  const state =
    typeof existingState === 'object' && existingState !== null
      ? { ...(existingState as Record<string, unknown>) }
      : {};

  state['mode'] = params.mode;
  state['modeConfidence'] = params.modeConfidence;
  state['modeRationale'] = params.modeRationale;
  state['modeUpdatedAtTurnCount'] = params.turnCount;
  next['state'] = state;

  return next;
}

const convLogger = new Logger({ serviceName: 'conversation' });

function clampRecentTurns(turns: MultiAgentMemoryTurn[], maxTurns = 10): MultiAgentMemoryTurn[] {
  if (turns.length <= maxTurns) return turns;
  return turns.slice(turns.length - maxTurns);
}

function stableTurnId(messageId: string): string {
  // Stable per inbound message, enabling idempotent per-turn audit keys.
  return crypto.createHash('sha256').update(messageId).digest('hex').slice(0, 16);
}

function offersToText(offers: Offer[]): string {
  if (offers.length === 0) return '';
  const lines = offers.slice(0, 3).map((o, idx) => {
    const money = `$${Math.round(o.amountTotalCop).toLocaleString('es-CO')}`;
    if (o.type === 'ONE_PAY') return `${idx + 1}) ${o.label}: ${money}`;
    if (o.type === 'INSTALLMENTS') {
      const per = o.amountPerInstallmentCop
        ? `$${Math.round(o.amountPerInstallmentCop).toLocaleString('es-CO')}`
        : '';
      return `${idx + 1}) ${o.label}: ${money}${per ? ` (≈ ${per} c/u)` : ''}`;
    }
    return `${idx + 1}) ${o.label}: ${money}`;
  });
  return lines.join('\n');
}

function defaultBudgetsSnapshot(params: {
  tenantPolicy: TenantPolicy;
  existing?: MultiAgentBudgetsSnapshot;
}): MultiAgentBudgetsSnapshot {
  const configured = params.tenantPolicy.conversationPolicy?.multiAgentOrchestration;
  const defaults = {
    maxNegotiationRounds: 6,
    maxSlotAsksPerSlot: 2,
    maxOffTopicRedirects: 2,
    abuseStrikeLimit: 3,
    maxRepairAttempts: configured?.maxRepairAttempts ?? 2,
  };

  const budgets = {
    maxNegotiationRounds:
      params.existing?.maxNegotiationRounds ??
      configured?.budgets?.maxNegotiationRounds ??
      defaults.maxNegotiationRounds,
    maxSlotAsksPerSlot:
      params.existing?.maxSlotAsksPerSlot ??
      configured?.budgets?.maxSlotAsksPerSlot ??
      defaults.maxSlotAsksPerSlot,
    maxOffTopicRedirects:
      params.existing?.maxOffTopicRedirects ??
      configured?.budgets?.maxOffTopicRedirects ??
      defaults.maxOffTopicRedirects,
    abuseStrikeLimit:
      params.existing?.abuseStrikeLimit ??
      configured?.budgets?.abuseStrikeLimit ??
      defaults.abuseStrikeLimit,
    maxRepairAttempts: params.existing?.maxRepairAttempts ?? defaults.maxRepairAttempts,
    counters: {
      negotiationRounds: params.existing?.counters?.negotiationRounds ?? 0,
      offTopicRedirects: params.existing?.counters?.offTopicRedirects ?? 0,
      abuseStrikes: params.existing?.counters?.abuseStrikes ?? 0,
      repairAttempts: params.existing?.counters?.repairAttempts ?? 0,
      slotAsks: params.existing?.counters?.slotAsks ?? {},
    },
  } satisfies MultiAgentBudgetsSnapshot;

  return budgets;
}

type NumericBudgetCounterKey = Exclude<keyof MultiAgentBudgetsSnapshot['counters'], 'slotAsks'>;

function bumpCounter(budgets: MultiAgentBudgetsSnapshot, key: NumericBudgetCounterKey) {
  budgets.counters[key] += 1;
}

function bumpSlotAsk(budgets: MultiAgentBudgetsSnapshot, slot: string) {
  const current = budgets.counters.slotAsks[slot] ?? 0;
  budgets.counters.slotAsks[slot] = current + 1;
}

function shouldUseAbRerank(params: {
  classifierConfidence: number;
  classifierFlags: Record<string, unknown> | undefined;
  negotiationRounds: number;
  mode: string;
}): boolean {
  if (params.classifierConfidence < 0.7) return true;

  const flags = params.classifierFlags ?? {};
  const isAmbiguousAmount = flags['ambiguousAmount'] === true;
  const isAmbiguousDate = flags['ambiguousDate'] === true;
  const hasContradiction = flags['contradiction'] === true;

  if (isAmbiguousAmount || isAmbiguousDate || hasContradiction) return true;
  if (params.negotiationRounds >= 2) return true;

  const mode = String(params.mode ?? '').toUpperCase();
  if (mode === 'DISPUTE' || mode === 'ABUSE_DEESCALATION') return true;

  return false;
}

function pickByScoreOrShorter(params: {
  scores?: { A: number; B: number };
  aText: string;
  bText: string;
}): 'A' | 'B' {
  const aScore = params.scores?.A;
  const bScore = params.scores?.B;
  if (typeof aScore === 'number' && typeof bScore === 'number') {
    if (aScore > bScore) return 'A';
    if (bScore > aScore) return 'B';
  }
  return params.aText.length <= params.bText.length ? 'A' : 'B';
}

function verifyTemplateDeterministic(params: {
  messageText: string;
  channel: 'whatsapp' | 'telegram';
}): { ok: true } | { ok: false; issues: Array<'TOO_LONG' | 'EMPTY' | 'HAS_PLACEHOLDER'> } {
  const maxChars = params.channel === 'whatsapp' ? 360 : 520;
  const text = params.messageText.trim();
  const issues: Array<'TOO_LONG' | 'EMPTY' | 'HAS_PLACEHOLDER'> = [];
  if (text.length < 1) issues.push('EMPTY');
  if (text.length > maxChars) issues.push('TOO_LONG');
  if (text.includes('{{') || text.includes('}}')) issues.push('HAS_PLACEHOLDER');
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export type ConversationTurnRunnerResult = {
  turnId: string;
  replyText: string;
  nextConversation: ConversationState;
  /** Optional: for reusing existing handoff logic in orchestrator. */
  handoffIntent?: 'DISPUTE' | 'ANGRY';
  handoffConfidence?: number;
  /** Optional: promise intent extracted by the pipeline (for reminders). */
  promise?: { amountCop: number; dateIso: string };
  /** Debug/audit payload (already persisted when policy allows). */
  auditPayload: Record<string, unknown>;
};

export class ConversationTurnRunner {
  static async runTurn(params: {
    tenant: Tenant;
    debtor: DebtorSnapshot;
    conversation: ConversationState;
    userText: string;
    channel: 'whatsapp' | 'telegram';
    messageId: string;
    atIso: string;
  }): Promise<ConversationTurnRunnerResult> {
    const turnId = stableTurnId(params.messageId);

    const policy = params.tenant.policy;
    const maxAttempts = policy.conversationPolicy?.multiAgentOrchestration?.maxRepairAttempts ?? 2;

    const useContextPackV1 =
      process.env.CONVERSATION_CONTEXT_PACK_V1_ENABLED === 'true' &&
      Boolean(policy.conversationPolicy?.contextPackV1?.enabled);

    const storeMessageText = policy.auditPolicy.storeMessageText;
    const storeDecisionPayloads = policy.auditPolicy.storeDecisionPayloads;

    const retentionDays = policy.auditPolicy.retentionDays;
    const ttl =
      retentionDays && retentionDays > 0
        ? Math.floor(Date.now() / 1000) + retentionDays * 24 * 60 * 60
        : undefined;

    const existingMa = params.conversation.multiAgent;
    const budgets = defaultBudgetsSnapshot({ tenantPolicy: policy, existing: existingMa?.budgets });

    const recentTurns: MultiAgentMemoryTurn[] = clampRecentTurns(
      (existingMa?.recentTurns ?? []).slice(),
      12
    );

    const nextTurnCount = (existingMa?.turnCount ?? 0) + 1;

    recentTurns.push({
      role: 'user',
      atIso: params.atIso,
      messageId: params.messageId,
      text: storeMessageText ? params.userText.slice(0, 800) : undefined,
    });

    const offers = buildOffers({
      tenantPolicy: policy,
      debtor: params.debtor,
      conversation: params.conversation,
    });

    const curatedPolicyRes = CuratedPolicyTool.resolvePolicySnapshot({
      countryCode: String(policy.contactPolicy?.countryCode ?? 'CO'),
      policyVersion: policy.conversationPolicy?.curatedPolicy?.versionOverride,
    });

    const assembled = useContextPackV1
      ? ContextAssembler.assembleV1({
          tenant: params.tenant,
          debtor: params.debtor,
          conversation: params.conversation,
          budgets,
          turnId,
          atIso: params.atIso,
          channel: params.channel,
          userText: params.userText,
        })
      : undefined;

    const pack = assembled?.pack;
    let summaryUpdatedThisTurn = false;
    let workingMemoryForNextTurn: Record<string, unknown> | undefined =
      (pack?.workingMemory as Record<string, unknown> | undefined) ??
      (existingMa?.workingMemory as Record<string, unknown> | undefined);

    // Summarize cadence (when enabled): refresh summaryMemory before planning.
    if (useContextPackV1 && pack) {
      const summarize = shouldSummarize({
        nextTurnCount,
        lastSummaryTurnCount: existingMa?.lastSummaryTurnCount,
        stateChanged: false,
        triggerIntent: params.conversation.lastIntent,
        windowExceeded: Boolean(assembled?.windowExceeded),
      });

      if (summarize) {
        const summarizerView: SummarizerView = {
          meta: pack.meta,
          lastTurns: pack.lastTurns.slice(-12),
          workingMemory: pack.workingMemory,
          debtSnapshot: pack.debtSnapshot,
          currentSummary: pack.summaryMemory,
        };

        const sum = await runSummarizer({ view: summarizerView, maxAttempts });
        if (sum.ok) {
          pack.summaryMemory = sum.value;
          pack.summaryMemory.updatedAtTurnCount = nextTurnCount;
          summaryUpdatedThisTurn = true;
        }
      }
    }

    const classifierRes =
      useContextPackV1 && pack
        ? await ClassifierAgent.runWithView({
            view: {
              meta: pack.meta,
              tonePolicy: pack.tenantConfig.tonePolicy,
              summaryMemory: pack.summaryMemory,
              lastTurns: pack.lastTurns,
              input: pack.input,
            } satisfies ClassifierView,
            maxAttempts,
          })
        : await ClassifierAgent.run({
            userText: params.userText,
            debtor: {
              totalDueCop: params.debtor.totalDueCop,
              daysPastDue: params.debtor.daysPastDue,
              stage: params.debtor.stage,
            },
            tenantPolicy: {
              handoffPolicy: policy.handoffPolicy,
              auditPolicy: policy.auditPolicy,
              tonePolicy: policy.tonePolicy,
            },
            conversationState: params.conversation.state,
            recentTurns,
            maxAttempts,
          });

    if (!classifierRes.ok) {
      const replyText =
        'Gracias por tu mensaje. En este momento tengo un inconveniente para procesarlo. ¿Podrías repetirlo o decirme si prefieres pagar hoy o acordar una fecha?';

      const nextConversation: ConversationState = {
        ...params.conversation,
        lastContactAt: params.atIso,
        multiAgent: {
          budgets,
          recentTurns: clampRecentTurns(
            [
              ...recentTurns,
              {
                role: 'assistant',
                atIso: params.atIso,
                text: storeMessageText ? replyText : undefined,
              },
            ],
            10
          ),
          lastTurnId: turnId,
          turnCount: nextTurnCount,
          lastSummaryTurnCount: existingMa?.lastSummaryTurnCount,
          summaryMemory: existingMa?.summaryMemory,
          workingMemory: existingMa?.workingMemory,
        },
      };

      const auditPayload: Record<string, unknown> = {
        version: 'v1',
        turnId,
        ok: false,
        stage: 'classifier',
        curatedPolicy: {
          countryCode: curatedPolicyRes.snapshot.countryCode,
          policyVersion: curatedPolicyRes.snapshot.policyVersion,
          effectiveDateIso: curatedPolicyRes.snapshot.effectiveDateIso,
          lastReviewedAtIso: curatedPolicyRes.snapshot.lastReviewedAtIso,
          sourceRefsMinimal: curatedPolicyRes.snapshot.sourceRefsMinimal,
          missingFallbackUsed: curatedPolicyRes.usedFallback,
          missingSourceIds: curatedPolicyRes.missingSourceIds,
        },
        error: classifierRes.error,
        classifierAttempts: classifierRes.attempts,
      };

      if (storeDecisionPayloads) {
        auditPayload['classifierRawHistory'] = classifierRes.rawHistory.slice(-3);
      }

      // Emit structured metric/log for classifier failures so CloudWatch metric filters can pick it up.
      try {
        convLogger.info('classifier.failure', {
          tenantId: params.tenant.tenantId,
          debtorId: params.debtor.debtorId,
          turnId,
          classifierAttempts: classifierRes.attempts,
          stage: 'classifier',
          error: classifierRes.error,
        });
      } catch (e) {
        // swallow logging errors
      }

      await putConversationTurnAudit({
        tenantId: params.tenant.tenantId,
        debtorId: params.debtor.debtorId,
        channel: params.channel,
        messageId: params.messageId,
        atIso: params.atIso,
        turnId,
        payload: auditPayload,
        ttl,
      });

      return { turnId, replyText, nextConversation, auditPayload };
    }

    // Budget counters derived from classifier output (LLM-driven).
    if (classifierRes.value.intent === 'OFF_TOPIC') bumpCounter(budgets, 'offTopicRedirects');
    if (classifierRes.value.intent === 'ABUSIVE') bumpCounter(budgets, 'abuseStrikes');

    // Deterministic date resolution using tenant timezone for phrases like "próximo viernes".
    try {
      const zone = params.tenant.policy.contactPolicy?.timezone || 'America/Bogota';
      const ref = DateTime.fromISO(params.atIso, { zone: 'utc' }).setZone(zone);
      const refIso = ref.toISO();
      const entities = (classifierRes.value.entities as Record<string, unknown> | undefined) ?? {};
      const flags = (classifierRes.value.flags as Record<string, unknown> | undefined) ?? {};
      const existingDate =
        typeof entities['dateIso'] === 'string' ? (entities['dateIso'] as string) : '';

      // If PAY_NOW, normalize to tenant-local today.
      const intentUpper = String(classifierRes.value.intent ?? '').toUpperCase();
      if (intentUpper === 'PAY_NOW') {
        entities['dateIso'] = ref.toISODate();
        flags['ambiguousDate'] = false;
        (classifierRes.value as any).entities = entities;
        (classifierRes.value as any).flags = flags;
      } else if (!existingDate || flags['ambiguousDate'] === true) {
        const parsed = parseNaturalDate(params.userText, refIso ?? undefined);
        if (parsed.dateIso) {
          entities['dateIso'] = parsed.dateIso;
          flags['ambiguousDate'] = false;
          (classifierRes.value as any).entities = entities;
          (classifierRes.value as any).flags = flags;
        }
      }
    } catch {
      /* ignore date resolution issues */
    }

    // Emit metrics for low-context and missing-date scenarios to help monitoring and alerts.
    try {
      const flags = classifierRes.value.flags as Record<string, unknown> | undefined;
      const intent = String(classifierRes.value.intent ?? '');
      if (
        flags &&
        flags['lowContext'] === true &&
        (intent === 'OFF_TOPIC' || intent === 'UNKNOWN')
      ) {
        convLogger.info('classifier.low_context', {
          tenantId: params.tenant.tenantId,
          debtorId: params.debtor.debtorId,
          turnId,
          intent,
          mode: classifierRes.value.mode,
          classifierAttempts: classifierRes.attempts,
        });
      }

      if (intent === 'PAY_LATER') {
        const entities = classifierRes.value.entities as Record<string, unknown> | undefined;
        const dateIso = entities ? entities['dateIso'] : undefined;
        if (!dateIso) {
          convLogger.info('classifier.missing_date_for_pay_later', {
            tenantId: params.tenant.tenantId,
            debtorId: params.debtor.debtorId,
            turnId,
            classifierAttempts: classifierRes.attempts,
          });
        }
      }
    } catch (e) {
      /* ignore logging issues */
    }

    // Persist conversation mode into workingMemory for downstream agents and next turns.
    if (useContextPackV1 && pack) {
      pack.workingMemory = withModeInWorkingMemory({
        workingMemory: pack.workingMemory as Record<string, unknown>,
        mode: classifierRes.value.mode,
        modeConfidence: classifierRes.value.modeConfidence,
        modeRationale: classifierRes.value.modeRationale,
        turnCount: nextTurnCount,
      });
      workingMemoryForNextTurn = pack.workingMemory as Record<string, unknown>;
    } else {
      workingMemoryForNextTurn = withModeInWorkingMemory({
        workingMemory: existingMa?.workingMemory as Record<string, unknown> | undefined,
        mode: classifierRes.value.mode,
        modeConfidence: classifierRes.value.modeConfidence,
        modeRationale: classifierRes.value.modeRationale,
        turnCount: nextTurnCount,
      });
    }

    // V2 path: enabled via env flag; tests default to V1.
    const useConvV2 = process.env.CONV_V2_ENABLED === 'true';

    if (useConvV2) {
      const curatedSnapshotForDeterministic =
        useContextPackV1 && pack ? pack.policySnapshot.curatedPolicy : curatedPolicyRes.snapshot;

      const v2 = await ConversationAgentV2.run({
        tenant: {
          tenantId: params.tenant.tenantId,
          name: params.tenant.name,
          policy: params.tenant.policy,
        },
        userText: params.userText,
        recentTurns,
        classifier: classifierRes.value,
        budgets,
        offersText: offersToText(offers),
        curatedPolicySnapshot: curatedSnapshotForDeterministic,
        maxAttempts,
      });

      const finalText = v2.ok
        ? v2.value.writerText
        : 'Gracias. Para ayudarte mejor, ¿me confirmas el valor que puedes pagar y la fecha aproximada?';

      // V2 observability: emit structured logs and bump counters for off-topic redirects.
      try {
        if (v2.ok) {
          const tpl = v2.value.plan.templateId ?? '';
          if (
            tpl === 'negotiation.reengage' ||
            tpl === 'negotiation.final_warning' ||
            tpl === 'negotiation.polite_close'
          ) {
            bumpCounter(budgets, 'offTopicRedirects');
            convLogger.info('v2.offtopic_redirect', {
              tenantId: params.tenant.tenantId,
              debtorId: params.debtor.debtorId,
              turnId,
              stage: tpl,
              offTopicRedirects: budgets.counters.offTopicRedirects,
              limit: budgets.maxOffTopicRedirects,
            });
          }

          if (v2.value.plan.summaryToConfirm) {
            convLogger.info('v2.promise_ready', {
              tenantId: params.tenant.tenantId,
              debtorId: params.debtor.debtorId,
              turnId,
              amountCop: v2.value.plan.summaryToConfirm.amountCop,
              dateIso: v2.value.plan.summaryToConfirm.dateIso,
            });
          }
        }
      } catch (e) {
        /* ignore logging issues */
      }

      const nextMa: MultiAgentConversationState = {
        budgets,
        recentTurns: clampRecentTurns(
          [
            ...recentTurns,
            {
              role: 'assistant',
              atIso: params.atIso,
              text: storeMessageText ? finalText : undefined,
            },
          ],
          10
        ),
        lastTurnId: turnId,
        turnCount: nextTurnCount,
        lastSummaryTurnCount: summaryUpdatedThisTurn
          ? nextTurnCount
          : existingMa?.lastSummaryTurnCount,
        summaryMemory: pack?.summaryMemory ?? existingMa?.summaryMemory,
        workingMemory: workingMemoryForNextTurn,
      };

      const nextConversation: ConversationState = {
        ...params.conversation,
        state: v2.ok ? v2.value.plan.stateAfter : params.conversation.state,
        lastIntent: classifierRes.value.intent,
        lastContactAt: params.atIso,
        multiAgent: nextMa,
      };

      const handoffIntent: ConversationTurnRunnerResult['handoffIntent'] =
        classifierRes.value.intent === 'DISPUTE'
          ? 'DISPUTE'
          : classifierRes.value.intent === 'ABUSIVE'
          ? 'ANGRY'
          : undefined;

      const auditPayload: Record<string, unknown> = {
        version: 'v1',
        ok: v2.ok,
        turnId,
        curatedPolicy: {
          countryCode: curatedPolicyRes.snapshot.countryCode,
          policyVersion: curatedPolicyRes.snapshot.policyVersion,
          effectiveDateIso: curatedPolicyRes.snapshot.effectiveDateIso,
          lastReviewedAtIso: curatedPolicyRes.snapshot.lastReviewedAtIso,
          sourceRefsMinimal: curatedPolicyRes.snapshot.sourceRefsMinimal,
          missingFallbackUsed: curatedPolicyRes.usedFallback,
          missingSourceIds: curatedPolicyRes.missingSourceIds,
        },
        classifier: storeDecisionPayloads ? classifierRes.value : undefined,
        plan: storeDecisionPayloads && v2.ok ? v2.value.plan : undefined,
        writer: storeDecisionPayloads && v2.ok ? { messageText: finalText } : undefined,
        templateUsed: v2.ok ? v2.value.templateUsed : false,
        abRerankUsed: false,
        budgets,
        offersCount: offers.length,
        handoffIntent,
      };

      if (storeDecisionPayloads) {
        auditPayload['classifierRawHistory'] = classifierRes.rawHistory.slice(-3);
        if (v2.ok) auditPayload['writerRawHistory'] = v2.rawHistory.slice(-3);
      }

      await putConversationTurnAudit({
        tenantId: params.tenant.tenantId,
        debtorId: params.debtor.debtorId,
        channel: params.channel,
        messageId: params.messageId,
        atIso: params.atIso,
        turnId,
        payload: auditPayload,
        ttl,
      });

      const v2Promise =
        v2.ok && v2.value.plan.summaryToConfirm
          ? {
              amountCop: v2.value.plan.summaryToConfirm.amountCop,
              dateIso: v2.value.plan.summaryToConfirm.dateIso,
            }
          : undefined;

      return {
        turnId,
        replyText: finalText,
        nextConversation,
        handoffIntent,
        handoffConfidence: handoffIntent ? classifierRes.value.confidence : undefined,
        promise: v2Promise,
        auditPayload,
      };
    }

    const plannerRes =
      useContextPackV1 && pack
        ? await PlannerAgent.runWithView({
            view: {
              pack,
              classifier: classifierRes.value as unknown as Record<string, unknown>,
            } satisfies PlannerView,
            maxAttempts,
          })
        : useConvV2
        ? ({
            ok: true,
            value: {
              ...(() => {
                // Build a minimal planner-like structure for V2 so WriterAgent can work.
                const intent = String(classifierRes.value.intent ?? '').toUpperCase();
                const mode = String(classifierRes.value.mode ?? 'NEGOTIATION');
                const flags =
                  (classifierRes.value.flags as Record<string, unknown> | undefined) ?? {};

                let actionType:
                  | 'ASK_SLOT'
                  | 'INFORM_TEMPLATE'
                  | 'INFORM'
                  | 'CONFIRM'
                  | 'OFFER_OPTIONS'
                  | 'REDIRECT'
                  | 'ESCALATE'
                  | 'END' = 'ASK_SLOT';

                let targetSlot:
                  | 'identityConfirmed'
                  | 'paymentAbility'
                  | 'commitAmount'
                  | 'commitDate'
                  | 'paymentMethod'
                  | 'preferredContactTime'
                  | undefined = 'commitAmount';

                let question: string | undefined =
                  '¿Qué valor puedes pagar y en qué fecha aproximada?';
                let templateId: string | undefined;

                if (intent === 'PAY_NOW') {
                  actionType = 'INFORM_TEMPLATE';
                  templateId = 'negotiation.pay_now';
                  targetSlot = undefined;
                  question = undefined;
                } else if (intent === 'INFO_REQUEST') {
                  actionType = 'INFORM_TEMPLATE';
                  templateId = 'info.how_to_pay';
                  targetSlot = undefined;
                  question = undefined;
                } else if (intent === 'PAY_LATER') {
                  const entities =
                    (classifierRes.value.entities as Record<string, unknown> | undefined) ?? {};
                  const dateIso =
                    typeof entities['dateIso'] === 'string' ? (entities['dateIso'] as string) : '';
                  if (!dateIso || flags['ambiguousDate'] === true) {
                    actionType = 'ASK_SLOT';
                    targetSlot = 'commitDate';
                    question = 'Perfecto. ¿Qué fecha te queda cómoda para pagar?';
                  } else {
                    actionType = 'ASK_SLOT';
                    targetSlot = 'commitAmount';
                    question = 'Genial. ¿Con qué valor te comprometes para esa fecha?';
                  }
                } else if (intent === 'OFF_TOPIC' || intent === 'UNKNOWN') {
                  const off = budgets.counters.offTopicRedirects;
                  const limit = budgets.maxOffTopicRedirects;
                  actionType = 'INFORM_TEMPLATE';
                  templateId =
                    off > limit
                      ? 'negotiation.polite_close'
                      : off >= limit
                      ? 'negotiation.final_warning'
                      : 'negotiation.reengage';
                  targetSlot = undefined;
                  question = undefined;
                }

                return {
                  actionType,
                  targetSlot,
                  question,
                  options: undefined,
                  templateId,
                  templateVars: undefined,
                  summaryToConfirm: undefined,
                  stateBefore: mode,
                  stateAfter: mode,
                  budgetsSnapshot: budgets,
                  complianceNotes: [],
                };
              })(),
            },
            attempts: 0,
            rawHistory: [],
          } as const)
        : await PlannerAgent.run({
            classifier: classifierRes.value,
            userText: params.userText,
            conversationState: params.conversation.state,
            recentTurns,
            budgets,
            offersSummary: { offersCount: offers.length },
            maxAttempts,
          });

    if (!plannerRes.ok) {
      // Deterministic fallback: select a template based on classifier intent/flags and budgets.
      let replyText =
        'Gracias por tu mensaje. Para ayudarte, ¿me confirmas si prefieres pagar hoy o acordar una fecha de pago?';

      try {
        const mode = String(
          classifierRes.value.mode ?? 'NEGOTIATION'
        ).toUpperCase() as TemplateMode;
        const tenantConfig = {
          tonePolicy: (useContextPackV1 && pack
            ? pack.tenantConfig.tonePolicy
            : (params.tenant.policy.tonePolicy as unknown as Record<string, string>)) as Record<
            string,
            string
          >,
          pronoun: 'TU' as const,
          emojiPolicy: 'NONE' as const,
        };

        const intent = String(classifierRes.value.intent ?? '').toUpperCase();
        const flags = (classifierRes.value.flags as unknown as Record<string, unknown>) ?? {};
        let templateId: string | undefined;

        if (intent === 'PAY_NOW') {
          templateId = 'negotiation.pay_now';
        } else if (
          flags['lowContext'] === true &&
          (intent === 'OFF_TOPIC' || intent === 'UNKNOWN')
        ) {
          const off = budgets.counters.offTopicRedirects;
          const limit = budgets.maxOffTopicRedirects;
          templateId =
            off > limit
              ? 'negotiation.polite_close'
              : off >= limit
              ? 'negotiation.final_warning'
              : 'negotiation.reengage';
        } else if (intent === 'INFO_REQUEST') {
          templateId = 'info.how_to_pay';
        } else {
          templateId = 'negotiation.reengage';
        }

        const rendered = TemplateLibrary.render({
          templateId,
          mode,
          vars: undefined,
          tenantConfig,
          tenantPolicy: params.tenant.policy,
        });

        if (rendered.ok) {
          const det = verifyTemplateDeterministic({
            messageText: rendered.value.messageText,
            channel: params.channel,
          });
          if (det.ok) {
            replyText = rendered.value.messageText;
          }
        }
      } catch {
        /* fall back to default replyText */
      }

      const nextConversation: ConversationState = {
        ...params.conversation,
        lastContactAt: params.atIso,
        lastIntent: classifierRes.value.intent,
        multiAgent: {
          budgets,
          recentTurns: clampRecentTurns(
            [
              ...recentTurns,
              {
                role: 'assistant',
                atIso: params.atIso,
                text: storeMessageText ? replyText : undefined,
              },
            ],
            10
          ),
          lastTurnId: turnId,
          turnCount: nextTurnCount,
          lastSummaryTurnCount: summaryUpdatedThisTurn
            ? nextTurnCount
            : existingMa?.lastSummaryTurnCount,
          summaryMemory: pack?.summaryMemory ?? existingMa?.summaryMemory,
          workingMemory: workingMemoryForNextTurn,
        },
      };

      const auditPayload: Record<string, unknown> = {
        version: 'v1',
        turnId,
        ok: false,
        stage: 'planner',
        curatedPolicy: {
          countryCode: curatedPolicyRes.snapshot.countryCode,
          policyVersion: curatedPolicyRes.snapshot.policyVersion,
          effectiveDateIso: curatedPolicyRes.snapshot.effectiveDateIso,
          lastReviewedAtIso: curatedPolicyRes.snapshot.lastReviewedAtIso,
          sourceRefsMinimal: curatedPolicyRes.snapshot.sourceRefsMinimal,
          missingFallbackUsed: curatedPolicyRes.usedFallback,
          missingSourceIds: curatedPolicyRes.missingSourceIds,
        },
        classifier: storeDecisionPayloads ? classifierRes.value : undefined,
        error: plannerRes.error,
        plannerAttempts: plannerRes.attempts,
      };

      if (storeDecisionPayloads) {
        auditPayload['plannerRawHistory'] = plannerRes.rawHistory.slice(-3);
        auditPayload['classifierRawHistory'] = classifierRes.rawHistory.slice(-3);
      }

      await putConversationTurnAudit({
        tenantId: params.tenant.tenantId,
        debtorId: params.debtor.debtorId,
        channel: params.channel,
        messageId: params.messageId,
        atIso: params.atIso,
        turnId,
        payload: auditPayload,
        ttl,
      });

      return { turnId, replyText, nextConversation, auditPayload };
    }

    if (plannerRes.value.actionType === 'ASK_SLOT' && plannerRes.value.targetSlot) {
      bumpSlotAsk(budgets, plannerRes.value.targetSlot);
    }
    if (
      plannerRes.value.actionType === 'OFFER_OPTIONS' ||
      plannerRes.value.actionType === 'CONFIRM'
    ) {
      bumpCounter(budgets, 'negotiationRounds');
    }

    const offersText = offersToText(offers);

    // Tool arbitration: when the planner selects INFORM_TEMPLATE, render deterministic response
    // and skip the Writer LLM (still checked by a deterministic verifier).
    const templateSelected = plannerRes.value.actionType === 'INFORM_TEMPLATE';

    const abRerankActivated =
      !templateSelected &&
      !useConvV2 &&
      shouldUseAbRerank({
        classifierConfidence: classifierRes.value.confidence,
        classifierFlags: classifierRes.value.flags as unknown as Record<string, unknown>,
        negotiationRounds: budgets.counters.negotiationRounds,
        mode: classifierRes.value.mode,
      });
    let templateAudit: Record<string, unknown> | undefined;
    if (templateSelected) {
      const mode = String(classifierRes.value.mode ?? 'NEGOTIATION').toUpperCase() as TemplateMode;

      const tenantConfig = {
        tonePolicy: (useContextPackV1 && pack
          ? pack.tenantConfig.tonePolicy
          : (params.tenant.policy.tonePolicy as unknown as Record<string, string>)) as Record<
          string,
          string
        >,
        pronoun: 'TU' as const,
        emojiPolicy: 'NONE' as const,
      };

      const templateId = plannerRes.value.templateId;
      if (typeof templateId === 'string' && templateId.length > 0) {
        const rendered = TemplateLibrary.render({
          templateId,
          mode,
          vars: plannerRes.value.templateVars as unknown as Record<string, unknown>,
          tenantConfig,
          tenantPolicy: params.tenant.policy,
        });

        if (rendered.ok) {
          const det = verifyTemplateDeterministic({
            messageText: rendered.value.messageText,
            channel: params.channel,
          });

          if (det.ok) {
            const curatedSnapshotForDeterministic =
              useContextPackV1 && pack
                ? pack.policySnapshot.curatedPolicy
                : curatedPolicyRes.snapshot;
            const policyDet = deterministicModeGuard({
              mode: classifierRes.value.mode,
              writer: { messageText: rendered.value.messageText },
              curatedPolicySnapshot: curatedSnapshotForDeterministic,
            });
            if (policyDet && policyDet.status === 'FAIL') {
              // Curated policy violation: fall through to Writer path for safe repair.
              templateAudit = {
                templateId: rendered.value.templateId,
                varsUsed: rendered.value.varsUsed,
                deterministicPolicyViolation: true,
                deterministicPolicyIssues: policyDet.issues,
              };
            } else {
              const currentWriter = {
                ok: true as const,
                value: {
                  messageText: rendered.value.messageText,
                  askUser: rendered.value.askUser,
                  metadata: rendered.value.metadata,
                },
                attempts: 0,
                rawHistory: [] as unknown[],
              };

              templateAudit = {
                templateId: rendered.value.templateId,
                varsUsed: rendered.value.varsUsed,
              };

              const finalText = currentWriter.value.messageText;

              const nextMa: MultiAgentConversationState = {
                budgets,
                recentTurns: clampRecentTurns(
                  [
                    ...recentTurns,
                    {
                      role: 'assistant',
                      atIso: params.atIso,
                      text: storeMessageText ? finalText : undefined,
                    },
                  ],
                  10
                ),
                lastTurnId: turnId,
                turnCount: nextTurnCount,
                lastSummaryTurnCount: summaryUpdatedThisTurn
                  ? nextTurnCount
                  : existingMa?.lastSummaryTurnCount,
                summaryMemory: pack?.summaryMemory ?? existingMa?.summaryMemory,
                workingMemory: workingMemoryForNextTurn,
              };

              const nextConversation: ConversationState = {
                ...params.conversation,
                state: plannerRes.value.stateAfter,
                lastIntent: classifierRes.value.intent,
                lastContactAt: params.atIso,
                multiAgent: nextMa,
              };

              const auditPayload: Record<string, unknown> = {
                version: 'v1',
                ok: true,
                turnId,
                curatedPolicy: {
                  countryCode: curatedPolicyRes.snapshot.countryCode,
                  policyVersion: curatedPolicyRes.snapshot.policyVersion,
                  effectiveDateIso: curatedPolicyRes.snapshot.effectiveDateIso,
                  lastReviewedAtIso: curatedPolicyRes.snapshot.lastReviewedAtIso,
                  sourceRefsMinimal: curatedPolicyRes.snapshot.sourceRefsMinimal,
                  missingFallbackUsed: curatedPolicyRes.usedFallback,
                  missingSourceIds: curatedPolicyRes.missingSourceIds,
                },
                classifier: storeDecisionPayloads ? classifierRes.value : undefined,
                plan: storeDecisionPayloads ? plannerRes.value : undefined,
                writer: storeDecisionPayloads ? currentWriter.value : undefined,
                templateUsed: true,
                abRerankUsed: abRerankActivated,
                budgets,
                offersCount: offers.length,
                promise: plannerRes.value.summaryToConfirm
                  ? {
                      amountCop: plannerRes.value.summaryToConfirm.amountCop,
                      dateIso: plannerRes.value.summaryToConfirm.dateIso,
                    }
                  : undefined,
                handoffIntent:
                  classifierRes.value.intent === 'DISPUTE'
                    ? 'DISPUTE'
                    : classifierRes.value.intent === 'ABUSIVE'
                    ? 'ANGRY'
                    : undefined,
              };

              if (storeDecisionPayloads && templateAudit) {
                auditPayload['template'] = templateAudit;
              }

              await putConversationTurnAudit({
                tenantId: params.tenant.tenantId,
                debtorId: params.debtor.debtorId,
                channel: params.channel,
                messageId: params.messageId,
                atIso: params.atIso,
                turnId,
                payload: auditPayload,
                ttl,
              });

              return {
                turnId,
                replyText: finalText,
                nextConversation,
                auditPayload,
                handoffIntent: auditPayload.handoffIntent as any,
                handoffConfidence: undefined,
                promise: auditPayload.promise as any,
              };
            }
          }
        }
      }
      // If template rendering fails, fall through to Writer path for safety.
    }

    let abRerankAudit: Record<string, unknown> | undefined;

    const runWriter = async (variantKey?: 'A' | 'B') =>
      useContextPackV1 && pack
        ? await WriterAgent.runWithView({
            view: {
              meta: pack.meta,
              tonePolicy: pack.tenantConfig.tonePolicy,
              input: pack.input,
              summaryMemory: pack.summaryMemory,
              lastTurns: pack.lastTurns,
              plan: plannerRes.value as unknown as Record<string, unknown>,
              classifier: classifierRes.value as unknown as Record<string, unknown>,
              offersText,
              variantKey,
            } satisfies WriterView,
            maxAttempts,
          })
        : await WriterAgent.run({
            tenant: {
              tenantId: params.tenant.tenantId,
              policy: params.tenant.policy,
              name: params.tenant.name,
            },
            userText: params.userText,
            classifier: classifierRes.value,
            plan: plannerRes.value,
            recentTurns,
            offersText,
            variantKey,
            maxAttempts,
          });

    let writerRes: Awaited<ReturnType<typeof runWriter>>;
    if (!abRerankActivated) {
      writerRes = await runWriter();
    } else {
      const preferShortMessages = true;
      const maxMessageChars = params.channel === 'whatsapp' ? 360 : 520;

      const writerA = await runWriter('A');
      const writerB = await runWriter('B');

      if (!writerA.ok && !writerB.ok) {
        writerRes = writerA;
      } else if (!writerA.ok) {
        abRerankAudit = {
          activated: true,
          selectedVariant: 'B',
          fallbackUsed: true,
          fallbackReason: 'writerA_failed',
        };
        writerRes = writerB;
      } else if (!writerB.ok) {
        abRerankAudit = {
          activated: true,
          selectedVariant: 'A',
          fallbackUsed: true,
          fallbackReason: 'writerB_failed',
        };
        writerRes = writerA;
      } else {
        const evalRes = await EvaluatorAgent.run({
          view: {
            mode: classifierRes.value.mode,
            plan: plannerRes.value as unknown as Record<string, unknown>,
            classifier: classifierRes.value as unknown as Record<string, unknown>,
            variants: {
              A: { messageText: writerA.value.messageText },
              B: { messageText: writerB.value.messageText },
            },
            tenantHints: {
              preferShortMessages,
              maxMessageChars,
            },
          },
          maxAttempts: 1,
        });

        if (evalRes.ok) {
          const selected = pickByScoreOrShorter({
            scores: evalRes.value.scores,
            aText: writerA.value.messageText,
            bText: writerB.value.messageText,
          });

          abRerankAudit = {
            activated: true,
            variantA: writerA.value,
            variantB: writerB.value,
            scores: evalRes.value.scores,
            evaluatorRationale: evalRes.value.rationale,
            selectedVariant: selected,
            fallbackUsed: false,
          };

          writerRes = selected === 'A' ? writerA : writerB;
        } else {
          // Fallback: if evaluator fails, use verifier PASS/FAIL and pick the PASS one, tie-break by shorter.
          const vA =
            useContextPackV1 && pack
              ? await VerifierAgent.runWithView({
                  view: {
                    meta: pack.meta,
                    policyHardRules: {
                      noThreats: true,
                      noHallucinations: true,
                      noSensitivePii: true,
                    },
                    curatedPolicySnapshot: pack.policySnapshot.curatedPolicy,
                    plan: plannerRes.value as unknown as Record<string, unknown>,
                    classifier: classifierRes.value as unknown as Record<string, unknown>,
                    debtSnapshot: pack.debtSnapshot,
                    writer: writerA.value as unknown as Record<string, unknown>,
                  } satisfies VerifierView,
                  maxAttempts,
                })
              : await VerifierAgent.run({
                  classifier: classifierRes.value,
                  plan: plannerRes.value,
                  writer: writerA.value,
                  recentTurns,
                  curatedPolicySnapshot: curatedPolicyRes.snapshot,
                  maxAttempts,
                });

          const vB =
            useContextPackV1 && pack
              ? await VerifierAgent.runWithView({
                  view: {
                    meta: pack.meta,
                    policyHardRules: {
                      noThreats: true,
                      noHallucinations: true,
                      noSensitivePii: true,
                    },
                    curatedPolicySnapshot: pack.policySnapshot.curatedPolicy,
                    plan: plannerRes.value as unknown as Record<string, unknown>,
                    classifier: classifierRes.value as unknown as Record<string, unknown>,
                    debtSnapshot: pack.debtSnapshot,
                    writer: writerB.value as unknown as Record<string, unknown>,
                  } satisfies VerifierView,
                  maxAttempts,
                })
              : await VerifierAgent.run({
                  classifier: classifierRes.value,
                  plan: plannerRes.value,
                  writer: writerB.value,
                  recentTurns,
                  curatedPolicySnapshot: curatedPolicyRes.snapshot,
                  maxAttempts,
                });

          const passA = vA.ok && vA.value.status === 'PASS';
          const passB = vB.ok && vB.value.status === 'PASS';

          let selected: 'A' | 'B' = 'A';
          if (passA && !passB) selected = 'A';
          else if (passB && !passA) selected = 'B';
          else {
            selected = pickByScoreOrShorter({
              aText: writerA.value.messageText,
              bText: writerB.value.messageText,
            });
          }

          abRerankAudit = {
            activated: true,
            variantA: writerA.value,
            variantB: writerB.value,
            selectedVariant: selected,
            fallbackUsed: true,
            fallbackReason: 'evaluator_failed',
            evaluatorError: evalRes.error,
            verifierA: vA.ok ? vA.value : { error: vA.error },
            verifierB: vB.ok ? vB.value : { error: vB.error },
          };

          writerRes = selected === 'A' ? writerA : writerB;
        }
      }
    }

    if (!writerRes.ok) {
      const replyText =
        'Gracias. Para ayudarte mejor, ¿me confirmas el valor que puedes pagar y la fecha aproximada?';

      const nextConversation: ConversationState = {
        ...params.conversation,
        lastContactAt: params.atIso,
        lastIntent: classifierRes.value.intent,
        state: plannerRes.value.stateAfter,
        multiAgent: {
          budgets,
          recentTurns: clampRecentTurns(
            [
              ...recentTurns,
              {
                role: 'assistant',
                atIso: params.atIso,
                text: storeMessageText ? replyText : undefined,
              },
            ],
            10
          ),
          lastTurnId: turnId,
          turnCount: nextTurnCount,
          lastSummaryTurnCount: summaryUpdatedThisTurn
            ? nextTurnCount
            : existingMa?.lastSummaryTurnCount,
          summaryMemory: pack?.summaryMemory ?? existingMa?.summaryMemory,
          workingMemory: workingMemoryForNextTurn,
        },
      };

      const auditPayload: Record<string, unknown> = {
        version: 'v1',
        turnId,
        ok: false,
        stage: 'writer',
        curatedPolicy: {
          countryCode: curatedPolicyRes.snapshot.countryCode,
          policyVersion: curatedPolicyRes.snapshot.policyVersion,
          effectiveDateIso: curatedPolicyRes.snapshot.effectiveDateIso,
          lastReviewedAtIso: curatedPolicyRes.snapshot.lastReviewedAtIso,
          sourceRefsMinimal: curatedPolicyRes.snapshot.sourceRefsMinimal,
          missingFallbackUsed: curatedPolicyRes.usedFallback,
          missingSourceIds: curatedPolicyRes.missingSourceIds,
        },
        classifier: storeDecisionPayloads ? classifierRes.value : undefined,
        plan: storeDecisionPayloads ? plannerRes.value : undefined,
        error: writerRes.error,
        writerAttempts: writerRes.attempts,
      };

      if (storeDecisionPayloads) {
        auditPayload['writerRawHistory'] = writerRes.rawHistory.slice(-3);
      }

      await putConversationTurnAudit({
        tenantId: params.tenant.tenantId,
        debtorId: params.debtor.debtorId,
        channel: params.channel,
        messageId: params.messageId,
        atIso: params.atIso,
        turnId,
        payload: auditPayload,
        ttl,
      });

      return { turnId, replyText, nextConversation, auditPayload };
    }

    const verifierHistory: Array<{ verifier: unknown; writer: unknown }> = [];

    let currentWriter = writerRes;
    let finalText = currentWriter.value.messageText;

    let repairsUsed = 0;
    while (true) {
      const verifierRes =
        useContextPackV1 && pack
          ? await VerifierAgent.runWithView({
              view: {
                meta: pack.meta,
                policyHardRules: {
                  noThreats: true,
                  noHallucinations: true,
                  noSensitivePii: true,
                },
                curatedPolicySnapshot: pack.policySnapshot.curatedPolicy,
                plan: plannerRes.value as unknown as Record<string, unknown>,
                classifier: classifierRes.value as unknown as Record<string, unknown>,
                debtSnapshot: pack.debtSnapshot,
                writer: currentWriter.value as unknown as Record<string, unknown>,
              } satisfies VerifierView,
              maxAttempts,
            })
          : await VerifierAgent.run({
              classifier: classifierRes.value,
              plan: plannerRes.value,
              writer: currentWriter.value,
              recentTurns,
              curatedPolicySnapshot: curatedPolicyRes.snapshot,
              maxAttempts,
            });

      if (!verifierRes.ok) {
        // If verifier itself fails, accept current writer text and stop.
        break;
      }

      verifierHistory.push({ verifier: verifierRes.value, writer: currentWriter.value });

      if (verifierRes.value.status === 'PASS') {
        finalText = currentWriter.value.messageText;
        break;
      }

      bumpCounter(budgets, 'repairAttempts');
      repairsUsed += 1;
      if (repairsUsed > budgets.maxRepairAttempts) break;

      if (useContextPackV1 && pack) {
        const writerView: WriterView = {
          meta: pack.meta,
          tonePolicy: pack.tenantConfig.tonePolicy,
          input: pack.input,
          summaryMemory: pack.summaryMemory,
          lastTurns: pack.lastTurns,
          plan: plannerRes.value as unknown as Record<string, unknown>,
          classifier: classifierRes.value as unknown as Record<string, unknown>,
          offersText,
        };

        const repaired = await runRepairAgent({
          view: writerView,
          repairInstructions: verifierRes.value.repairInstructions ?? '',
          previousMessageText: currentWriter.value.messageText,
          maxAttempts,
        });

        if (!repaired.ok) break;
        currentWriter = repaired;
        finalText = currentWriter.value.messageText;
      } else {
        const repaired = await WriterAgent.run({
          tenant: {
            tenantId: params.tenant.tenantId,
            policy: params.tenant.policy,
            name: params.tenant.name,
          },
          userText: params.userText,
          classifier: classifierRes.value,
          plan: plannerRes.value,
          recentTurns,
          offersText,
          repairInstructions: verifierRes.value.repairInstructions,
          previousMessageText: currentWriter.value.messageText,
          maxAttempts,
        });

        if (!repaired.ok) break;
        currentWriter = repaired;
        finalText = currentWriter.value.messageText;
      }
    }

    const handoffIntent: ConversationTurnRunnerResult['handoffIntent'] =
      classifierRes.value.intent === 'DISPUTE'
        ? 'DISPUTE'
        : classifierRes.value.intent === 'ABUSIVE'
        ? 'ANGRY'
        : undefined;

    const promise = plannerRes.value.summaryToConfirm
      ? {
          amountCop: plannerRes.value.summaryToConfirm.amountCop,
          dateIso: plannerRes.value.summaryToConfirm.dateIso,
        }
      : undefined;

    const nextMa: MultiAgentConversationState = {
      budgets,
      recentTurns: clampRecentTurns(
        [
          ...recentTurns,
          {
            role: 'assistant',
            atIso: params.atIso,
            text: storeMessageText ? finalText : undefined,
          },
        ],
        10
      ),
      lastTurnId: turnId,
      turnCount: nextTurnCount,
      lastSummaryTurnCount: summaryUpdatedThisTurn
        ? nextTurnCount
        : existingMa?.lastSummaryTurnCount,
      summaryMemory: pack?.summaryMemory ?? existingMa?.summaryMemory,
      workingMemory: workingMemoryForNextTurn,
    };

    const nextConversation: ConversationState = {
      ...params.conversation,
      state: plannerRes.value.stateAfter,
      lastIntent: classifierRes.value.intent,
      lastContactAt: params.atIso,
      multiAgent: nextMa,
    };

    const auditPayload: Record<string, unknown> = {
      version: 'v1',
      ok: true,
      turnId,
      curatedPolicy: {
        countryCode: curatedPolicyRes.snapshot.countryCode,
        policyVersion: curatedPolicyRes.snapshot.policyVersion,
        effectiveDateIso: curatedPolicyRes.snapshot.effectiveDateIso,
        lastReviewedAtIso: curatedPolicyRes.snapshot.lastReviewedAtIso,
        sourceRefsMinimal: curatedPolicyRes.snapshot.sourceRefsMinimal,
        missingFallbackUsed: curatedPolicyRes.usedFallback,
        missingSourceIds: curatedPolicyRes.missingSourceIds,
      },
      classifier: storeDecisionPayloads ? classifierRes.value : undefined,
      plan: storeDecisionPayloads ? plannerRes.value : undefined,
      writer: storeDecisionPayloads ? currentWriter.value : undefined,
      templateUsed: false,
      abRerankUsed: abRerankActivated,
      budgets,
      offersCount: offers.length,
      promise,
      handoffIntent,
    };

    if (storeDecisionPayloads) {
      auditPayload['classifierRawHistory'] = classifierRes.rawHistory.slice(-3);
      auditPayload['plannerRawHistory'] = plannerRes.rawHistory.slice(-3);
      auditPayload['writerRawHistory'] = currentWriter.rawHistory.slice(-3);
      auditPayload['verifierHistory'] = verifierHistory.slice(-3);
      auditPayload['offers'] = offers.slice(0, 3);

      if (abRerankAudit) {
        auditPayload['abRerank'] = abRerankAudit;
      }
    }

    await putConversationTurnAudit({
      tenantId: params.tenant.tenantId,
      debtorId: params.debtor.debtorId,
      channel: params.channel,
      messageId: params.messageId,
      atIso: params.atIso,
      turnId,
      payload: auditPayload,
      ttl,
    });

    return {
      turnId,
      replyText: finalText,
      nextConversation,
      handoffIntent,
      handoffConfidence: handoffIntent ? classifierRes.value.confidence : undefined,
      promise,
      auditPayload,
    };
  }
}
