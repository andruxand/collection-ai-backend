import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ConversationTurnRunner } from '@/core/conversation/ConversationTurnRunner';
import type { ConversationState, DebtorSnapshot, Tenant } from '@/core/types';

const llmJson = vi.fn();

vi.mock('@/core/llm/llmClient', () => ({
  llmJson: (...args: unknown[]) => llmJson(...args),
}));

vi.mock('@/core/store/repos', () => {
  return {
    putConversationTurnAudit: vi.fn().mockResolvedValue(undefined),
  };
});

function makeTenant(): Tenant {
  return {
    tenantId: 'tenant-demo',
    name: 'Demo',
    policy: {
      contactPolicy: {
        timezone: 'America/Bogota',
        maxContactsPerDay: 2,
        noMultichannelSameWeekAfterDirectContact: true,
        hours: {
          monFri: { from: '08:00', to: '18:00' },
          sat: { from: '09:00', to: '13:00' },
          sunBlocked: true,
          holidaysBlocked: true,
        },
      },
      contactLimitsByStage: {
        EARLY: { maxOutboundPerDay: 1, maxOutboundPerWeek: 3 },
        MID: { maxOutboundPerDay: 1, maxOutboundPerWeek: 2 },
        LATE: { maxOutboundPerDay: 1, maxOutboundPerWeek: 1 },
      },
      cooldowns: { rejectedOfferDays: 2, noResponseDays: 3, brokenPromiseDays: 7 },
      offerPolicy: {
        ladder: [{ attempt: 1, maxDiscountPct: 0 }],
        maxAttempts: 6,
        hardCapDiscountPct: 20,
      },
      auditPolicy: { retentionDays: 30, storeMessageText: true, storeDecisionPayloads: true },
      exportPolicy: { enabled: false },
      notificationPolicy: {
        email: {
          enabled: false,
          fromAddress: '',
          toAddresses: [],
          subjectPrefix: '[CollectionsAI]',
          includeInboundText: false,
        },
      },
      handoffPolicy: { enabled: true, stageMin: 'MID', intents: ['DISPUTE', 'ANGRY'] },
      tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' },
      conversationPolicy: {
        multiAgentOrchestration: {
          enabled: true,
          maxRepairAttempts: 2,
          budgets: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
          },
        },
      },
    },
    channels: {},
  };
}

function makeDebtor(): DebtorSnapshot {
  return {
    tenantId: 'tenant-demo',
    debtorId: 'D1',
    totalDueCop: 500000,
    daysPastDue: 45,
    stage: 'MID',
    consents: { whatsapp: true, telegram: true },
  };
}

function makeConversation(): ConversationState {
  return { state: 'WELCOME', slots: {}, attemptCount: 1 };
}

describe('ConversationTurnRunner', () => {
  beforeEach(() => {
    llmJson.mockClear();
  });

  test('curated policy is resolved per-tenant and supports version override (fallback recorded in audit)', async () => {
    llmJson.mockImplementation(async (_prompt: string, _schema: unknown, name: string) => {
      if (name === 'classifier') {
        return {
          intent: 'PAY_LATER',
          mode: 'NEGOTIATION',
          modeConfidence: 0.72,
          modeRationale: 'Default negotiation mode.',
          entities: {},
          flags: {
            ambiguousAmount: false,
            ambiguousDate: false,
            contradiction: false,
            lowContext: false,
            sensitiveRequest: false,
            requiresHuman: false,
          },
          confidence: 0.9,
          rationale: 'OK.',
        };
      }

      if (name === 'planner') {
        return {
          actionType: 'ASK_SLOT',
          targetSlot: 'commitAmount',
          stateBefore: 'WELCOME',
          stateAfter: 'WELCOME',
          budgetsSnapshot: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
            maxRepairAttempts: 2,
            counters: {
              negotiationRounds: 0,
              offTopicRedirects: 0,
              abuseStrikes: 0,
              repairAttempts: 0,
              slotAsks: {},
            },
          },
          complianceNotes: [],
        };
      }

      if (name === 'writer') {
        return {
          messageText: '¿Me confirmas cuánto puedes pagar y para qué fecha?',
          askUser: true,
          metadata: { tone: 'T1', languageVariant: 'es-CO', includedSummary: false },
        };
      }

      if (name === 'verifier') {
        return { status: 'PASS', issues: [] };
      }

      return {};
    });

    const tenant = makeTenant();
    tenant.policy.contactPolicy.countryCode = 'CO';
    tenant.policy.conversationPolicy = {
      ...(tenant.policy.conversationPolicy ?? {}),
      multiAgentOrchestration: tenant.policy.conversationPolicy?.multiAgentOrchestration ?? {
        enabled: true,
        maxRepairAttempts: 2,
      },
      curatedPolicy: { versionOverride: '1900-01-01.v999' },
    };

    const res = await ConversationTurnRunner.runTurn({
      tenant,
      debtor: makeDebtor(),
      conversation: makeConversation(),
      userText: 'Hola',
      channel: 'whatsapp',
      messageId: 'm_curated_override_1',
      atIso: '2026-01-18T00:00:10.000Z',
    });

    const curated = (res.auditPayload as Record<string, unknown>)['curatedPolicy'] as
      | Record<string, unknown>
      | undefined;
    expect(curated).toBeTruthy();
    expect(curated?.countryCode).toBe('CO');
    expect(curated?.missingFallbackUsed).toBe(true);
    expect(curated?.policyVersion).toBe('baseline.safe.v1');
  });

  test('A/B rerank activates on low confidence and selects best-scoring variant', async () => {
    llmJson.mockImplementation(async (prompt: string, _schema: unknown, name: string) => {
      if (name === 'classifier') {
        return {
          intent: 'PAY_LATER',
          mode: 'NEGOTIATION',
          modeConfidence: 0.72,
          modeRationale: 'Default negotiation mode.',
          entities: {},
          flags: {
            ambiguousAmount: false,
            ambiguousDate: false,
            contradiction: false,
            lowContext: false,
            sensitiveRequest: false,
            requiresHuman: false,
          },
          confidence: 0.6,
          rationale: 'Low confidence → activate A/B.',
        };
      }

      if (name === 'planner') {
        return {
          actionType: 'ASK_SLOT',
          targetSlot: 'commitAmount',
          stateBefore: 'WELCOME',
          stateAfter: 'WELCOME',
          budgetsSnapshot: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
            maxRepairAttempts: 2,
            counters: {
              negotiationRounds: 0,
              offTopicRedirects: 0,
              abuseStrikes: 0,
              repairAttempts: 0,
              slotAsks: {},
            },
          },
          complianceNotes: [],
        };
      }

      if (name === 'writer') {
        if (prompt.includes('"variantKey":"A"')) {
          return {
            messageText: 'VARIANT A',
            askUser: true,
            metadata: { tone: 'T1', languageVariant: 'es-CO', includedSummary: false },
          };
        }
        if (prompt.includes('"variantKey":"B"')) {
          return {
            messageText: 'VARIANT B',
            askUser: true,
            metadata: { tone: 'T1', languageVariant: 'es-CO', includedSummary: false },
          };
        }
        throw new Error('Expected writer to receive variantKey');
      }

      if (name === 'evaluator') {
        return {
          selectedVariant: 'A',
          scores: { A: 90, B: 10 },
          rationale: 'A is clearer.',
        };
      }

      if (name === 'verifier') {
        return { status: 'PASS', issues: [] };
      }

      return {};
    });

    const res = await ConversationTurnRunner.runTurn({
      tenant: makeTenant(),
      debtor: makeDebtor(),
      conversation: makeConversation(),
      userText: 'Necesito tiempo para pagar',
      channel: 'whatsapp',
      messageId: 'm_ab_1',
      atIso: '2026-01-18T00:00:10.000Z',
    });

    expect(res.replyText).toBe('VARIANT A');
    expect(res.auditPayload.abRerankUsed).toBe(true);

    const ab = (res.auditPayload as Record<string, unknown>)['abRerank'] as
      | Record<string, unknown>
      | undefined;
    expect(ab).toBeTruthy();
    expect(ab).toMatchObject({
      activated: true,
      fallbackUsed: false,
      selectedVariant: 'A',
      scores: { A: 90, B: 10 },
    });

    const writerCalls = llmJson.mock.calls.filter((c) => c[2] === 'writer');
    const evaluatorCalls = llmJson.mock.calls.filter((c) => c[2] === 'evaluator');
    expect(writerCalls).toHaveLength(2);
    expect(evaluatorCalls).toHaveLength(1);
  });

  test('A/B rerank falls back to verifier when evaluator fails (pick PASS, tie-break shorter)', async () => {
    llmJson.mockImplementation(async (prompt: string, _schema: unknown, name: string) => {
      if (name === 'classifier') {
        return {
          intent: 'PAY_LATER',
          mode: 'NEGOTIATION',
          modeConfidence: 0.72,
          modeRationale: 'Default negotiation mode.',
          entities: {},
          flags: {
            ambiguousAmount: true,
            ambiguousDate: false,
            contradiction: false,
            lowContext: false,
            sensitiveRequest: false,
            requiresHuman: false,
          },
          confidence: 0.95,
          rationale: 'Ambiguous amount triggers A/B.',
        };
      }

      if (name === 'planner') {
        return {
          actionType: 'ASK_SLOT',
          targetSlot: 'commitAmount',
          stateBefore: 'WELCOME',
          stateAfter: 'WELCOME',
          budgetsSnapshot: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
            maxRepairAttempts: 2,
            counters: {
              negotiationRounds: 0,
              offTopicRedirects: 0,
              abuseStrikes: 0,
              repairAttempts: 0,
              slotAsks: {},
            },
          },
          complianceNotes: [],
        };
      }

      if (name === 'writer') {
        if (prompt.includes('"variantKey":"A"')) {
          return {
            messageText: 'VARIANT A LONG LONG LONG',
            askUser: true,
            metadata: { tone: 'T1', languageVariant: 'es-CO', includedSummary: false },
          };
        }
        if (prompt.includes('"variantKey":"B"')) {
          return {
            messageText: 'VARIANT B',
            askUser: true,
            metadata: { tone: 'T1', languageVariant: 'es-CO', includedSummary: false },
          };
        }
        throw new Error('Expected writer to receive variantKey');
      }

      if (name === 'evaluator') {
        throw new Error('evaluator down');
      }

      if (name === 'verifier') {
        if (prompt.includes('VARIANT A LONG LONG LONG')) {
          return { status: 'FAIL', issues: ['too long'] };
        }
        return { status: 'PASS', issues: [] };
      }

      return {};
    });

    const res = await ConversationTurnRunner.runTurn({
      tenant: makeTenant(),
      debtor: makeDebtor(),
      conversation: makeConversation(),
      userText: 'Pago algo pero no sé cuánto',
      channel: 'whatsapp',
      messageId: 'm_ab_2',
      atIso: '2026-01-18T00:00:11.000Z',
    });

    expect(res.replyText).toBe('VARIANT B');
    expect(res.auditPayload.abRerankUsed).toBe(true);

    const ab = (res.auditPayload as Record<string, unknown>)['abRerank'] as
      | Record<string, unknown>
      | undefined;
    expect(ab).toBeTruthy();
    expect(ab).toMatchObject({
      activated: true,
      fallbackUsed: true,
      fallbackReason: 'evaluator_failed',
      selectedVariant: 'B',
    });
  });

  test('A/B rerank activates in DISPUTE mode even with high confidence', async () => {
    llmJson.mockImplementation(async (prompt: string, _schema: unknown, name: string) => {
      if (name === 'classifier') {
        return {
          intent: 'DISPUTE',
          mode: 'DISPUTE',
          modeConfidence: 0.9,
          modeRationale: 'Dispute mode.',
          entities: {},
          flags: {
            ambiguousAmount: false,
            ambiguousDate: false,
            contradiction: false,
            lowContext: false,
            sensitiveRequest: false,
            requiresHuman: true,
          },
          confidence: 0.95,
          rationale: 'User disputes the debt.',
        };
      }

      if (name === 'planner') {
        return {
          actionType: 'END',
          stateBefore: 'WELCOME',
          stateAfter: 'WELCOME',
          budgetsSnapshot: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
            maxRepairAttempts: 2,
            counters: {
              negotiationRounds: 0,
              offTopicRedirects: 0,
              abuseStrikes: 0,
              repairAttempts: 0,
              slotAsks: {},
            },
          },
          complianceNotes: [],
        };
      }

      if (name === 'writer') {
        if (prompt.includes('"variantKey":"A"')) {
          return {
            messageText: 'DISPUTE A',
            askUser: false,
            metadata: { tone: 'T3', languageVariant: 'es-CO', includedSummary: false },
          };
        }
        if (prompt.includes('"variantKey":"B"')) {
          return {
            messageText: 'DISPUTE B',
            askUser: false,
            metadata: { tone: 'T3', languageVariant: 'es-CO', includedSummary: false },
          };
        }
        throw new Error('Expected writer to receive variantKey');
      }

      if (name === 'evaluator') {
        return {
          selectedVariant: 'B',
          scores: { A: 10, B: 20 },
          rationale: 'B is better for dispute.',
        };
      }

      if (name === 'verifier') {
        return { status: 'PASS', issues: [] };
      }

      return {};
    });

    const res = await ConversationTurnRunner.runTurn({
      tenant: makeTenant(),
      debtor: makeDebtor(),
      conversation: makeConversation(),
      userText: 'Esa deuda no es mía',
      channel: 'whatsapp',
      messageId: 'm_ab_3',
      atIso: '2026-01-18T00:00:12.000Z',
    });

    expect(res.replyText).toBe('DISPUTE B');
    expect(res.auditPayload.abRerankUsed).toBe(true);
  });

  test('ContextPack mode passes deterministic candidates to planner', async () => {
    const prev = process.env.CONVERSATION_CONTEXT_PACK_V1_ENABLED;
    process.env.CONVERSATION_CONTEXT_PACK_V1_ENABLED = 'true';

    llmJson.mockImplementation(async (prompt: string, _schema: unknown, name: string) => {
      if (name === 'classifier') {
        return {
          intent: 'PAY_LATER',
          mode: 'NEGOTIATION',
          modeConfidence: 0.72,
          modeRationale: 'Default negotiation mode; user is discussing payment options.',
          entities: {},
          flags: {
            ambiguousAmount: false,
            ambiguousDate: false,
            contradiction: false,
            lowContext: false,
            sensitiveRequest: false,
            requiresHuman: false,
          },
          confidence: 0.8,
          rationale: 'User mentions multiple amounts; needs clarification.',
        };
      }

      if (name === 'planner') {
        expect(prompt).toContain('"pack"');
        expect(prompt).toContain('"candidates"');
        expect(prompt).toContain('"ambiguousAmount":true');
        return {
          actionType: 'ASK_SLOT',
          targetSlot: 'commitAmount',
          stateBefore: 'WELCOME',
          stateAfter: 'WELCOME',
          budgetsSnapshot: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
            maxRepairAttempts: 2,
            counters: {
              negotiationRounds: 0,
              offTopicRedirects: 0,
              abuseStrikes: 0,
              repairAttempts: 0,
              slotAsks: {},
            },
          },
          complianceNotes: [],
        };
      }

      if (name === 'writer') {
        return {
          messageText: 'Para ayudarte, ¿qué valor exacto puedes pagar?',
          askUser: true,
          metadata: { tone: 'T1', languageVariant: 'es-CO', includedSummary: false },
        };
      }

      if (name === 'verifier') {
        return { status: 'PASS', issues: [] };
      }

      return {};
    });

    const tenant = makeTenant();
    tenant.policy.conversationPolicy = {
      ...tenant.policy.conversationPolicy,
      contextPackV1: { enabled: true, defaultLastTurns: 8 },
    };

    const res = await ConversationTurnRunner.runTurn({
      tenant,
      debtor: makeDebtor(),
      conversation: makeConversation(),
      userText: 'Pago 100 o 200 mañana',
      channel: 'whatsapp',
      messageId: 'm_ctx_1',
      atIso: '2026-01-18T00:00:00.000Z',
    });

    expect(res.replyText).toContain('valor');

    process.env.CONVERSATION_CONTEXT_PACK_V1_ENABLED = prev;
  });

  test('ContextPack mode reflects classifier-driven budget counters', async () => {
    const prev = process.env.CONVERSATION_CONTEXT_PACK_V1_ENABLED;
    process.env.CONVERSATION_CONTEXT_PACK_V1_ENABLED = 'true';

    llmJson.mockImplementation(async (prompt: string, _schema: unknown, name: string) => {
      if (name === 'classifier') {
        return {
          intent: 'ABUSIVE',
          mode: 'ABUSE_DEESCALATION',
          modeConfidence: 0.9,
          modeRationale: 'User is abusive; de-escalation mode.',
          entities: {},
          flags: {
            ambiguousAmount: false,
            ambiguousDate: false,
            contradiction: false,
            lowContext: false,
            sensitiveRequest: false,
            requiresHuman: true,
          },
          confidence: 0.95,
          rationale: 'User is abusive.',
        };
      }

      if (name === 'planner') {
        expect(prompt).toContain('"budgetsRuntime"');
        expect(prompt).toContain('"abuseStrikes":1');
        return {
          actionType: 'END',
          stateBefore: 'WELCOME',
          stateAfter: 'WELCOME',
          budgetsSnapshot: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
            maxRepairAttempts: 2,
            counters: {
              negotiationRounds: 0,
              offTopicRedirects: 0,
              abuseStrikes: 1,
              repairAttempts: 0,
              slotAsks: {},
            },
          },
          complianceNotes: [],
        };
      }

      if (name === 'writer') {
        return {
          messageText:
            'Entiendo. Por ahora cerraré esta conversación. Si deseas retomar, responde cuando estés listo/a.',
          askUser: false,
          metadata: { tone: 'T3', languageVariant: 'es-CO', includedSummary: false },
        };
      }

      if (name === 'verifier') {
        return { status: 'PASS', issues: [] };
      }

      return {};
    });

    const tenant = makeTenant();
    tenant.policy.conversationPolicy = {
      ...tenant.policy.conversationPolicy,
      contextPackV1: { enabled: true, defaultLastTurns: 8 },
    };

    const res = await ConversationTurnRunner.runTurn({
      tenant,
      debtor: makeDebtor(),
      conversation: makeConversation(),
      userText: 'Insultos y groserías',
      channel: 'whatsapp',
      messageId: 'm_ctx_2',
      atIso: '2026-01-18T00:00:02.000Z',
    });

    expect(res.replyText).toContain('cerrar');

    process.env.CONVERSATION_CONTEXT_PACK_V1_ENABLED = prev;
  });

  test('runs classify->plan->write->verify and returns reply', async () => {
    llmJson.mockImplementation(async (_prompt: string, _schema: unknown, name: string) => {
      if (name === 'classifier') {
        return {
          intent: 'PAY_LATER',
          mode: 'NEGOTIATION',
          modeConfidence: 0.8,
          modeRationale: 'Payment negotiation flow.',
          entities: { amountCop: 120000, dateIso: '2026-01-20' },
          flags: {
            ambiguousAmount: false,
            ambiguousDate: false,
            contradiction: false,
            lowContext: false,
            sensitiveRequest: false,
            requiresHuman: false,
          },
          confidence: 0.9,
          rationale: 'User commits to pay later with date and amount.',
        };
      }
      if (name === 'planner') {
        return {
          actionType: 'CONFIRM',
          stateBefore: 'WELCOME',
          stateAfter: 'PROMISE',
          budgetsSnapshot: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
            maxRepairAttempts: 2,
            counters: {
              negotiationRounds: 0,
              offTopicRedirects: 0,
              abuseStrikes: 0,
              repairAttempts: 0,
              slotAsks: {},
            },
          },
          complianceNotes: [],
          summaryToConfirm: { amountCop: 120000, dateIso: '2026-01-20', paymentMethod: 'PSE' },
        };
      }
      if (name === 'writer') {
        return {
          messageText:
            'Perfecto. Confirmo tu promesa de pago por $120.000 para el 2026-01-20. ¿Deseas pagar por PSE?',
          askUser: true,
          metadata: { tone: 'T2', languageVariant: 'es-CO', includedSummary: true },
        };
      }
      if (name === 'verifier') {
        return { status: 'PASS', issues: [] };
      }
      return {};
    });

    const res = await ConversationTurnRunner.runTurn({
      tenant: makeTenant(),
      debtor: makeDebtor(),
      conversation: makeConversation(),
      userText: 'Pago 120 mil el 20 de enero',
      channel: 'whatsapp',
      messageId: 'm1',
      atIso: '2026-01-18T00:00:00.000Z',
    });

    expect(res.replyText).toContain('Confirmo');
    expect(res.promise).toEqual({ amountCop: 120000, dateIso: '2026-01-20' });
    expect(res.nextConversation.state).toBe('PROMISE');
  });

  test('repairs writer when verifier fails', async () => {
    let verifierCall = 0;
    let writerCall = 0;

    llmJson.mockImplementation(async (_prompt: string, _schema: unknown, name: string) => {
      if (name === 'classifier') {
        return {
          intent: 'OFF_TOPIC',
          mode: 'NEGOTIATION',
          modeConfidence: 0.55,
          modeRationale: 'Off-topic but still in negotiation context.',
          entities: {},
          flags: {
            ambiguousAmount: false,
            ambiguousDate: false,
            contradiction: false,
            lowContext: true,
            sensitiveRequest: false,
            requiresHuman: false,
          },
          confidence: 0.8,
          rationale: 'User is off-topic.',
        };
      }
      if (name === 'planner') {
        return {
          actionType: 'REDIRECT',
          stateBefore: 'WELCOME',
          stateAfter: 'WELCOME',
          budgetsSnapshot: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
            maxRepairAttempts: 2,
            counters: {
              negotiationRounds: 0,
              offTopicRedirects: 0,
              abuseStrikes: 0,
              repairAttempts: 0,
              slotAsks: {},
            },
          },
          complianceNotes: [],
        };
      }
      if (name === 'writer') {
        writerCall += 1;
        return {
          messageText:
            writerCall >= 2
              ? 'Entiendo. Para ayudarte, volvamos al tema del pago: ¿prefieres pagar hoy o acordar una fecha?'
              : 'Claro, el clima está agradable.',
          askUser: true,
          metadata: { tone: 'T1', languageVariant: 'es-CO', includedSummary: false },
        };
      }
      if (name === 'verifier') {
        verifierCall += 1;
        if (verifierCall === 1) {
          return {
            status: 'FAIL',
            issues: ['NOT_MATCHING_PLAN'],
            repairInstructions: 'Redirige el mensaje al tema de pago y haz una pregunta concreta.',
          };
        }
        return { status: 'PASS', issues: [] };
      }
      return {};
    });

    const res = await ConversationTurnRunner.runTurn({
      tenant: makeTenant(),
      debtor: makeDebtor(),
      conversation: makeConversation(),
      userText: '¿Viste el partido ayer?',
      channel: 'whatsapp',
      messageId: 'm2',
      atIso: '2026-01-18T00:00:01.000Z',
    });

    expect(res.replyText).toContain('volvamos al tema');
  });

  test('INFORM_TEMPLATE bypasses Writer LLM and returns deterministic template', async () => {
    llmJson.mockClear();
    llmJson.mockImplementation(async (_prompt: string, _schema: unknown, name: string) => {
      if (name === 'classifier') {
        return {
          intent: 'WRONG_PERSON',
          mode: 'WRONG_PERSON',
          modeConfidence: 0.95,
          modeRationale: 'User says wrong number/person.',
          entities: {},
          flags: {
            ambiguousAmount: false,
            ambiguousDate: false,
            contradiction: false,
            lowContext: false,
            sensitiveRequest: false,
            requiresHuman: false,
          },
          confidence: 0.9,
          rationale: 'Clear wrong person signal.',
        };
      }

      if (name === 'planner') {
        return {
          actionType: 'INFORM_TEMPLATE',
          templateId: 'wrong_person.safe_exit',
          stateBefore: 'WELCOME',
          stateAfter: 'WELCOME',
          budgetsSnapshot: {
            maxNegotiationRounds: 6,
            maxSlotAsksPerSlot: 2,
            maxOffTopicRedirects: 2,
            abuseStrikeLimit: 3,
            maxRepairAttempts: 2,
            counters: {
              negotiationRounds: 0,
              offTopicRedirects: 0,
              abuseStrikes: 0,
              repairAttempts: 0,
              slotAsks: {},
            },
          },
          complianceNotes: [],
        };
      }

      if (name === 'writer') {
        throw new Error('Writer should not be called for templates');
      }

      if (name === 'verifier') {
        throw new Error('Verifier LLM should not be called for templates');
      }

      return {};
    });

    const res = await ConversationTurnRunner.runTurn({
      tenant: makeTenant(),
      debtor: makeDebtor(),
      conversation: makeConversation(),
      userText: 'Se equivocaron de persona',
      channel: 'whatsapp',
      messageId: 'm_tpl_1',
      atIso: '2026-01-18T00:00:20.000Z',
    });

    expect(res.replyText).toContain('Gracias por avisar');
    expect(res.auditPayload.templateUsed).toBe(true);

    const writerCalls = llmJson.mock.calls.filter((c) => c[2] === 'writer');
    const verifierCalls = llmJson.mock.calls.filter((c) => c[2] === 'verifier');
    expect(writerCalls).toHaveLength(0);
    expect(verifierCalls).toHaveLength(0);

    const template = (res.auditPayload as Record<string, unknown>)['template'] as
      | Record<string, unknown>
      | undefined;
    expect(template).toBeTruthy();
    expect(template).toMatchObject({ templateId: 'wrong_person.safe_exit' });
  });
});
