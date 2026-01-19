import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ContactState,
  ConversationState,
  DebtorSnapshot,
  NluResult,
  NormalizedInboundEvent,
  Tenant,
} from '@/core/types';

// --- Mocks ---
const ensureIdempotency = vi.fn();
const getTenant = vi.fn();
const resolveDebtorIfExists = vi.fn();
const getContact = vi.fn();
const putContact = vi.fn();
const getConversation = vi.fn();
const putConversation = vi.fn();
const putReminder = vi.fn();
const putAudit = vi.fn();
const bumpOutboundCounters = vi.fn();
const getCountryPolicy = vi.fn();

vi.mock('@/core/store/repos', () => ({
  ensureIdempotency: (...args: unknown[]) => ensureIdempotency(...args),
  getTenant: (...args: unknown[]) => getTenant(...args),
  resolveDebtorIfExists: (...args: unknown[]) => resolveDebtorIfExists(...args),
  getContact: (...args: unknown[]) => getContact(...args),
  putContact: (...args: unknown[]) => putContact(...args),
  getConversation: (...args: unknown[]) => getConversation(...args),
  putConversation: (...args: unknown[]) => putConversation(...args),
  putReminder: (...args: unknown[]) => putReminder(...args),
  putAudit: (...args: unknown[]) => putAudit(...args),
  bumpOutboundCounters: (...args: unknown[]) => bumpOutboundCounters(...args),
  getCountryPolicy: (...args: unknown[]) => getCountryPolicy(...args),
}));

const redeemTelegramEnrollmentCode = vi.fn();
vi.mock('@/core/store/enrollmentCodes', () => ({
  redeemTelegramEnrollmentCode: (...args: unknown[]) => redeemTelegramEnrollmentCode(...args),
}));

const parseIntent = vi.fn();
vi.mock('@/core/nlu/parseIntent', () => ({
  parseIntent: (...args: unknown[]) => parseIntent(...args),
}));

const writeResponse = vi.fn();
vi.mock('@/core/llm/responseWriter', () => ({
  writeResponse: (...args: unknown[]) => writeResponse(...args),
}));

const safetyFilter = vi.fn();
vi.mock('@/core/llm/safetyFilter', () => ({
  safetyFilter: (...args: unknown[]) => safetyFilter(...args),
}));

const sendWhatsApp = vi.fn();
vi.mock('@/core/channels/whatsappSender', () => ({
  sendWhatsApp: (...args: unknown[]) => sendWhatsApp(...args),
}));

const sendTelegram = vi.fn();
vi.mock('@/core/channels/telegramSender', () => ({
  sendTelegram: (...args: unknown[]) => sendTelegram(...args),
}));

const maybeHandoff = vi.fn();
vi.mock('@/core/handoff/handoff', () => ({
  maybeHandoff: (...args: unknown[]) => maybeHandoff(...args),
}));

const decideWithDialogueManager = vi.fn();
vi.mock('@/core/dialogue/dialogueManager', () => ({
  decideWithDialogueManager: (...args: unknown[]) => decideWithDialogueManager(...args),
}));

// Import after mocks
import { handler } from '@/handlers/orchestrator';

function makeTenant(overrides?: Partial<Tenant>): Tenant {
  return {
    tenantId: 'tenant-demo',
    name: 'Demo',
    policy: {
      contactPolicy: {
        timezone: 'America/Bogota',
        countryCode: 'CO',
        maxContactsPerDay: 5,
        noMultichannelSameWeekAfterDirectContact: false,
        hours: {
          monFri: { from: '08:00', to: '18:00' },
          sat: { from: '09:00', to: '13:00' },
          sunBlocked: true,
          holidaysBlocked: false,
        },
      },
      contactLimitsByStage: {
        EARLY: { maxOutboundPerDay: 10, maxOutboundPerWeek: 10 },
        MID: { maxOutboundPerDay: 10, maxOutboundPerWeek: 10 },
        LATE: { maxOutboundPerDay: 10, maxOutboundPerWeek: 10 },
      },
      cooldowns: { rejectedOfferDays: 3, noResponseDays: 3, brokenPromiseDays: 7 },
      offerPolicy: {
        ladder: [{ attempt: 1, maxDiscountPct: 0 }],
        maxAttempts: 3,
        hardCapDiscountPct: 30,
      },
      auditPolicy: { retentionDays: 7, storeMessageText: true, storeDecisionPayloads: true },
      exportPolicy: { enabled: false },
      notificationPolicy: {
        email: {
          enabled: false,
          fromAddress: 'x',
          toAddresses: [],
          subjectPrefix: '',
          includeInboundText: false,
        },
      },
      handoffPolicy: {
        enabled: false,
        stageMin: 'MID',
        intents: ['ANGRY'],
        retentionDays: 30,
        storeInboundText: true,
      },
      tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' },
    },
    channels: {
      whatsapp: { phoneNumberId: 'pn', accessTokenSecretId: 'sec' },
    },
    ...overrides,
  };
}

function makeDebtor(overrides?: Partial<DebtorSnapshot>): DebtorSnapshot {
  return {
    tenantId: 'tenant-demo',
    debtorId: 'd1',
    phoneE164: '+573001112233',
    totalDueCop: 500000,
    daysPastDue: 10,
    dueDate: '2026-01-01',
    stage: 'EARLY',
    consents: { whatsapp: true, telegram: false },
    ...overrides,
  };
}

function makeContact(overrides?: Partial<ContactState>): ContactState {
  return {
    tenantId: 'tenant-demo',
    debtorId: 'd1',
    optedOut: false,
    outboundDaily: {},
    outboundWeekly: {},
    ...overrides,
  };
}

function makeConv(overrides?: Partial<ConversationState>): ConversationState {
  return { state: 'WELCOME', slots: {}, attemptCount: 1, ...overrides };
}

function makeEvent(inbound: NormalizedInboundEvent): SQSEvent {
  return { Records: [{ body: JSON.stringify(inbound) }] } as unknown as SQSEvent;
}

describe('orchestrator handler', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.env.DIALOGUE_MANAGER_ENABLED = 'false';
    ensureIdempotency.mockResolvedValue(true);
    getTenant.mockResolvedValue(makeTenant());
    resolveDebtorIfExists.mockResolvedValue(makeDebtor());
    getContact.mockResolvedValue(makeContact());
    getConversation.mockResolvedValue(makeConv());
    putContact.mockResolvedValue(undefined);
    putConversation.mockResolvedValue(undefined);
    putReminder.mockResolvedValue(undefined);
    putAudit.mockResolvedValue(undefined);
    bumpOutboundCounters.mockResolvedValue(undefined);
    maybeHandoff.mockResolvedValue({ handedOff: false });
    writeResponse.mockResolvedValue('DRAFT');
    safetyFilter.mockResolvedValue('SAFE');
    sendWhatsApp.mockResolvedValue(undefined);
    sendTelegram.mockResolvedValue(undefined);
    getCountryPolicy.mockResolvedValue(undefined);
    decideWithDialogueManager.mockResolvedValue(undefined);
    redeemTelegramEnrollmentCode.mockResolvedValue(undefined);
  });

  it('shows offers and increments attemptCount', async () => {
    const nlu: NluResult = {
      intent: 'NEGOTIATE',
      entities: {},
      confidence: 0.8,
      topicShift: false,
    };
    parseIntent.mockResolvedValue(nlu);

    const inbound: NormalizedInboundEvent = {
      tenantId: 'tenant-demo',
      channel: 'whatsapp',
      debtorRef: { phoneE164: '+573001112233', waFrom: '573001112233' },
      message: { id: 'm1', type: 'text', text: 'Quiero negociar' },
      receivedAt: new Date().toISOString(),
      meta: {},
    };

    await handler(makeEvent(inbound));

    expect(sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(bumpOutboundCounters).toHaveBeenCalledTimes(1);
    expect(putConversation).toHaveBeenCalledTimes(1);

    const convArg = putConversation.mock.calls[0][3] as ConversationState;
    expect(convArg.attemptCount).toBe(2);
    expect(convArg.state).toBe('OFFER_MENU');
    expect(convArg.lastIntent).toBe('NEGOTIATE');
  });

  it('replies with enrollment instructions when debtor is not enrolled (whatsapp)', async () => {
    resolveDebtorIfExists.mockResolvedValue(undefined);

    const inbound: NormalizedInboundEvent = {
      tenantId: 'tenant-demo',
      channel: 'whatsapp',
      debtorRef: { phoneE164: '+573001112233', waFrom: '573001112233' },
      message: { id: 'm-unenrolled', type: 'text', text: 'Hola' },
      receivedAt: new Date().toISOString(),
      meta: {},
    };

    await handler(makeEvent(inbound));

    expect(sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(putConversation).toHaveBeenCalledTimes(0);
    expect(parseIntent).toHaveBeenCalledTimes(0);
  });

  it('short-circuits replies when case is CLOSED', async () => {
    getContact.mockResolvedValue(
      makeContact({ caseStatus: 'CLOSED', caseCloseReason: 'PAGO CONFIRMADO' })
    );

    const inbound: NormalizedInboundEvent = {
      tenantId: 'tenant-demo',
      channel: 'whatsapp',
      debtorRef: { phoneE164: '+573001112233', waFrom: '573001112233' },
      message: { id: 'm-case-closed', type: 'text', text: 'Hola' },
      receivedAt: new Date().toISOString(),
      meta: {},
    };

    await handler(makeEvent(inbound));

    expect(sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(parseIntent).toHaveBeenCalledTimes(0);
    expect(putConversation).toHaveBeenCalledTimes(0);
  });

  it('redeems telegram enrollment code and proceeds with normal flow', async () => {
    // First resolution fails (unenrolled), then after redeem it succeeds.
    resolveDebtorIfExists
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(
        makeDebtor({ telegramUserId: '123', consents: { whatsapp: false, telegram: true } })
      );

    redeemTelegramEnrollmentCode.mockResolvedValue({ debtorId: 'd1' });

    const nlu: NluResult = {
      intent: 'ASK_DETAIL',
      entities: {},
      confidence: 0.9,
      topicShift: false,
    };
    parseIntent.mockResolvedValue(nlu);

    const inbound: NormalizedInboundEvent = {
      tenantId: 'tenant-demo',
      channel: 'telegram',
      debtorRef: { telegramUserId: '123', telegramChatId: '123' },
      message: { id: 'tg-enroll-1', type: 'text', text: 'VINCULAR ABCD1234' },
      receivedAt: new Date().toISOString(),
      meta: {},
    };

    await handler(makeEvent(inbound));

    expect(redeemTelegramEnrollmentCode).toHaveBeenCalledTimes(1);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(parseIntent).toHaveBeenCalledTimes(1);
  });

  it('persists cooldown to contact when NBA returns COOLDOWN', async () => {
    // Make maxAttempts = 1 and attemptCount = 1 so cooldown fires (for UNKNOWN intent)
    getTenant.mockResolvedValue(
      makeTenant({
        policy: {
          ...makeTenant().policy,
          offerPolicy: { ...makeTenant().policy.offerPolicy, maxAttempts: 1 },
        },
      })
    );
    getConversation.mockResolvedValue(makeConv({ attemptCount: 1 }));

    const nlu: NluResult = { intent: 'UNKNOWN', entities: {}, confidence: 0.2, topicShift: false };
    parseIntent.mockResolvedValue(nlu);

    const inbound: NormalizedInboundEvent = {
      tenantId: 'tenant-demo',
      channel: 'whatsapp',
      debtorRef: { phoneE164: '+573001112233', waFrom: '573001112233' },
      message: { id: 'm2', type: 'text', text: '...' },
      receivedAt: new Date().toISOString(),
      meta: {},
    };

    await handler(makeEvent(inbound));

    // one call sets lastDirectContact, another sets cooldown
    const calls = putContact.mock.calls.map((c) => c[2]) as Array<Record<string, unknown>>;
    const hasCooldown = calls.some((c) => typeof c.nextContactAllowedAt === 'string');
    expect(hasCooldown).toBe(true);
  });

  it('enforces playbook primaryAction when DM returns menu-loop NBA', async () => {
    process.env.DIALOGUE_MANAGER_ENABLED = 'true';

    getTenant.mockResolvedValue(
      makeTenant({
        policy: {
          ...makeTenant().policy,
          strategyPolicy: {
            defaultObjective: 'NEGOTIATE',
            objectivePlaybook: {
              NEGOTIATE: {
                goal: 'Llevar a un acuerdo concreto (oferta).',
                primaryAction: 'SHOW_OFFERS',
                secondaryAction: 'CLARIFY',
              },
            },
          },
        },
      })
    );

    const nlu: NluResult = {
      intent: 'NEGOTIATE',
      entities: {},
      confidence: 0.8,
      topicShift: false,
    };

    decideWithDialogueManager.mockResolvedValue({
      decision: {
        nlu,
        nba: { action: 'FALLBACK_MENU', nextState: 'WELCOME', slotsUpdate: {} },
        confidence: 0.9,
      },
      nlu,
      nba: { action: 'FALLBACK_MENU', nextState: 'WELCOME', slotsUpdate: {} },
      confidence: 0.9,
      raw: {},
    });

    const inbound: NormalizedInboundEvent = {
      tenantId: 'tenant-demo',
      channel: 'whatsapp',
      debtorRef: { phoneE164: '+573001112233', waFrom: '573001112233' },
      message: { id: 'm3', type: 'text', text: 'Quiero negociar' },
      receivedAt: new Date().toISOString(),
      meta: {},
    };

    await handler(makeEvent(inbound));

    const convArg = putConversation.mock.calls[0][3] as ConversationState;
    expect(convArg.state).toBe('OFFER_MENU');
    expect(convArg.attemptCount).toBe(2);
  });
});
