import type { MultiAgentBudgetsSnapshot, MultiAgentMemoryTurn, Tenant } from '../types';
import { type ClassifierOutput, type PlannerOutput } from './schemas';
import { validateAmountCop, validateDateIso, validatePaymentMethod } from './tools/slots';
import { parseNaturalDate } from './nlDateParser';
import { parseFlexibleMoney } from './nlMoneyParser';
import { WriterAgent } from './WriterAgent';
import { deterministicModeGuard } from './VerifierAgent';

function buildMicroPlan(params: {
  classifier: ClassifierOutput;
  budgets: MultiAgentBudgetsSnapshot;
  atIso: string;
  userText: string;
}): PlannerOutput {
  const intent = String(params.classifier.intent ?? '').toUpperCase();
  const mode = String(params.classifier.mode ?? 'NEGOTIATION');
  const flags = (params.classifier.flags as Record<string, unknown> | undefined) ?? {};
  const entities = (params.classifier.entities as Record<string, unknown> | undefined) ?? {};

  // Observed slots from user text when responding to a slot question.
  const dateGuess = parseNaturalDate(params.userText, params.atIso);
  const moneyGuess = parseFlexibleMoney(params.userText);
  const observedDateIso = dateGuess.confidence >= 0.7 ? dateGuess.dateIso : null;
  const observedAmount = moneyGuess.confidence >= 0.7 ? moneyGuess.amountCop : null;

  // Default plan asks for missing commitment data with one clarification per slot.
  let actionType: PlannerOutput['actionType'] = 'ASK_SLOT';
  let targetSlot: PlannerOutput['targetSlot'] = 'commitAmount';
  let question: string | undefined = '¿Qué valor puedes pagar y en qué fecha aproximada?';
  let templateId: string | undefined;
  let summaryToConfirm: PlannerOutput['summaryToConfirm'] | undefined;

  if (intent === 'PAY_NOW') {
    actionType = 'INFORM_TEMPLATE';
    templateId = 'negotiation.pay_now';
    targetSlot = undefined;
    question = undefined;
  } else if (intent === 'PAY_LATER' || observedDateIso || observedAmount) {
    const dateIso = validateDateIso(entities['dateIso']) || observedDateIso || undefined;
    const amountCop = validateAmountCop(entities['amountCop']) || observedAmount || undefined;
    const method = validatePaymentMethod(entities['paymentMethod']);
    if (!dateIso || flags['ambiguousDate'] === true) {
      actionType = 'ASK_SLOT';
      targetSlot = 'commitDate';
      question = 'Perfecto. ¿Qué fecha te queda cómoda para pagar?';
    } else if (!amountCop) {
      actionType = 'ASK_SLOT';
      targetSlot = 'commitAmount';
      question = 'Genial. ¿Con qué valor te comprometes para esa fecha?';
    } else {
      actionType = 'CONFIRM';
      targetSlot = undefined;
      question = undefined;
      summaryToConfirm = {
        amountCop,
        dateIso,
        paymentMethod: method ?? 'PSE',
      };
    }
  } else if (intent === 'INFO_REQUEST') {
    actionType = 'INFORM_TEMPLATE';
    templateId = 'info.how_to_pay';
    targetSlot = undefined;
    question = undefined;
  } else if (intent === 'OFF_TOPIC' || intent === 'UNKNOWN') {
    const off = params.budgets.counters.offTopicRedirects;
    const limit = params.budgets.maxOffTopicRedirects;
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
    summaryToConfirm,
    stateBefore: mode,
    stateAfter: summaryToConfirm ? 'PROMISE' : mode,
    budgetsSnapshot: params.budgets,
    complianceNotes: [],
  } as PlannerOutput;
}

export class ConversationAgentV2 {
  static async run(params: {
    tenant: Pick<Tenant, 'tenantId' | 'policy' | 'name'>;
    userText: string;
    recentTurns: MultiAgentMemoryTurn[];
    classifier: ClassifierOutput;
    budgets: MultiAgentBudgetsSnapshot;
    offersText?: string;
    curatedPolicySnapshot: unknown;
    maxAttempts: number;
    atIso: string;
  }): Promise<
    | {
        ok: true;
        value: {
          writerText: string;
          plan: PlannerOutput;
          templateUsed: boolean;
        };
        attempts: number;
        rawHistory: unknown[];
      }
    | { ok: false; error: string; attempts: number; rawHistory: unknown[] }
  > {
    const plan = buildMicroPlan({
      classifier: params.classifier,
      budgets: params.budgets,
      recentTurns: params.recentTurns,
      atIso: params.atIso,
      userText: params.userText,
    });

    const writer = await WriterAgent.run({
      tenant: params.tenant,
      userText: params.userText,
      classifier: params.classifier,
      plan,
      recentTurns: params.recentTurns,
      offersText: params.offersText,
      maxAttempts: params.maxAttempts,
    });

    if (!writer.ok) {
      return {
        ok: false,
        error: writer.error,
        attempts: writer.attempts,
        rawHistory: writer.rawHistory,
      };
    }

    // Lightweight policy guard; if it fails, fallback to a safe, concise message.
    const policyDet = deterministicModeGuard({
      mode: params.classifier.mode,
      writer: { messageText: writer.value.messageText },
      curatedPolicySnapshot: params.curatedPolicySnapshot,
    });

    if (policyDet && policyDet.status === 'FAIL') {
      const safeText = 'Puedo ayudarte con el pago. ¿Prefieres pagar hoy o acordar una fecha?';
      return {
        ok: true,
        value: { writerText: safeText, plan, templateUsed: false },
        attempts: writer.attempts,
        rawHistory: writer.rawHistory,
      };
    }

    return {
      ok: true,
      value: {
        writerText: writer.value.messageText,
        plan,
        templateUsed: plan.actionType === 'INFORM_TEMPLATE',
      },
      attempts: writer.attempts,
      rawHistory: writer.rawHistory,
    };
  }
}
