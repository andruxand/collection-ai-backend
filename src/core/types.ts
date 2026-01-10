export type Channel = 'whatsapp' | 'telegram';

export type NormalizedInboundEvent = {
  tenantId: string;
  channel: Channel;
  // internal stable identity (resolve by phone/telegramUserId)
  debtorRef: {
    phoneE164?: string;
    telegramUserId?: string;
    telegramChatId?: string;
    waFrom?: string; // wa user id (phone without + usually)
  };
  message: {
    id: string;
    text?: string;
    type: 'text' | 'interactive' | 'unknown';
    raw?: unknown;
  };
  receivedAt: string;
  // channel metadata
  meta: Record<string, unknown>;
};

export type TenantStage = 'EARLY' | 'MID' | 'LATE';

export type TenantPolicy = {
  contactPolicy: {
    timezone: string; // e.g. America/Bogota
    countryCode?: string; // e.g. CO, CL, MX (for holiday calendars)
    /** Optional: computed from CountryPolicy + TenantPolicy. When present, outbound may be blocked per channel. */
    channelsAllowed?: { whatsapp: boolean; telegram: boolean };
    maxContactsPerDay: number; // legacy/global cap (outbound)
    noMultichannelSameWeekAfterDirectContact: boolean;
    hours: {
      monFri: { from: string; to: string };
      sat: { from: string; to: string };
      sunBlocked: boolean;
      holidaysBlocked: boolean;
    };
  };

  // Stage-based caps for outbound contacts (configurable per tenant)
  contactLimitsByStage: Record<
    TenantStage,
    {
      maxOutboundPerDay: number;
      maxOutboundPerWeek: number;
    }
  >;

  cooldowns: {
    rejectedOfferDays: number;
    noResponseDays: number;
    brokenPromiseDays: number;
  };

  offerPolicy: {
    ladder: Array<{ attempt: number; maxDiscountPct: number }>;
    maxAttempts: number;
    hardCapDiscountPct: number;
  };

  // Audit retention + redaction controls
  auditPolicy: {
    retentionDays: number; // TTL for AUDIT items (0 disables TTL)
    storeMessageText: boolean; // store full text or omit
    storeDecisionPayloads: boolean; // store policy/nlu/nba/offers
  };

  // Optional export of audit logs to S3 (manual trigger via admin endpoint)
  exportPolicy: {
    enabled: boolean;
    s3Bucket?: string;
    s3Prefix?: string; // e.g. tenants/<tenantId>/audit/
  };

  // Notifications (email) for handoff / assignment
  notificationPolicy: {
    email: {
      enabled: boolean;
      fromAddress: string; // SES verified sender
      toAddresses: string[]; // default recipients (ops queue)
      subjectPrefix: string;
      includeInboundText: boolean;
    };
  };

  // Human handoff rules (routes to SQS queue)
  handoffPolicy: {
    enabled: boolean;
    stageMin: TenantStage; // only handoff when debtor.stage >= stageMin
    intents: Array<'DISPUTE' | 'ANGRY'>;
    /** TTL for handoff cases in days (0 disables TTL). Defaults to 30 at runtime. */
    retentionDays?: number;
    /** Whether to store inbound text on the handoff case. Defaults to true at runtime. */
    storeInboundText?: boolean;
  };

  tonePolicy: {
    T1: string;
    T2: string;
    T3: string;
  };
};

export type CountryPolicy = {
  countryCode: string; // CO, CL, MX...
  version: string; // e.g. "v1"
  updatedAtIso: string;

  contactPolicy: {
    timezone: string; // default timezone for the country
    channelsAllowed: { whatsapp: boolean; telegram: boolean; voice?: boolean };
    maxContactsPerDay: number; // global/day cap (outbound)
    noMultichannelSameWeekAfterDirectContact: boolean;

    hours: {
      monFri: { from: string; to: string };
      sat: { from: string; to: string };
      sunBlocked: boolean;
      holidaysBlocked: boolean;
    };
  };

  contactLimitsByStage: Record<
    TenantStage,
    {
      maxOutboundPerDay: number;
      maxOutboundPerWeek: number;
    }
  >;

  cooldowns: {
    noResponseDays: number;
    brokenPromiseDays: number;
  };
};

export type Tenant = {
  tenantId: string;
  name: string;
  clientAuth?: ClientAuthConfig;
  policy: TenantPolicy;
  channels: {
    whatsapp?: {
      phoneNumberId: string;
      accessTokenSecretId: string; // Secrets Manager secret id/arn
    };
    telegram?: {
      botTokenSecretId: string;
    };
  };
};

export type ConversationState = {
  state: string;
  slots: Record<string, unknown>;
  attemptCount: number;
  lastIntent?: string;
  lastContactAt?: string;
  nextContactAllowedAt?: string;
};

export type ContactState = {
  tenantId: string;
  debtorId: string;

  optedOut?: boolean;

  // user replied (inbound on a channel)
  lastDirectContactAt?: string;
  lastDirectContactChannel?: Channel;

  // last proactive message we sent
  lastOutboundAt?: string;

  // computed cooldown for outbound reminders/campaigns
  nextContactAllowedAt?: string;

  // Outbound counters (keys are local date/week per tenant timezone)
  outboundDaily?: Record<string, number>; // YYYY-MM-DD -> count
  outboundWeekly?: Record<string, number>; // YYYY-Www -> count
};

export type DebtorSnapshot = {
  tenantId: string;
  debtorId: string;
  phoneE164?: string;
  telegramUserId?: string;
  // debt info
  totalDueCop: number;
  daysPastDue: number;
  dueDate?: string;
  stage: 'EARLY' | 'MID' | 'LATE';
  consents: {
    whatsapp: boolean;
    telegram: boolean;
  };
  // extra
  attemptCount?: number;
};

export type NluResult = {
  intent:
    | 'PAY_NOW'
    | 'NEGOTIATE'
    | 'PROMISE_PAYMENT'
    | 'ASK_DETAIL'
    | 'DISPUTE'
    | 'ALREADY_PAID'
    | 'OPT_OUT'
    | 'ANGRY'
    | 'OFFTOPIC'
    | 'SYSTEM_TICK'
    | 'UNKNOWN';
  entities: {
    amountCop?: number;
    dateIso?: string; // YYYY-MM-DD
    paymentMethod?: 'PSE' | 'CARD' | 'TRANSFER' | 'CASH';
  };
  confidence: number;
  topicShift: boolean;
};

export type NbaDecision =
  | {
      action: 'OPT_OUT';
      nextState: string;
      slotsUpdate: Record<string, unknown>;
      nextContactAllowedAt?: string;
    }
  | { action: 'REDIRECT_MENU'; nextState: string; slotsUpdate: Record<string, unknown> }
  | {
      action: 'ASK_SLOT';
      nextState: string;
      slotsUpdate: Record<string, unknown>;
      slot: 'promiseDate' | 'promiseAmount' | 'paymentMethod';
    }
  | { action: 'SHOW_OFFERS'; nextState: string; slotsUpdate: Record<string, unknown> }
  | { action: 'SEND_PAYMENT_LINK'; nextState: string; slotsUpdate: Record<string, unknown> }
  | { action: 'PROACTIVE_OUTREACH'; nextState: string; slotsUpdate: Record<string, unknown> }
  | { action: 'CREATE_PROMISE'; nextState: string; slotsUpdate: Record<string, unknown> }
  | { action: 'FALLBACK_MENU'; nextState: string; slotsUpdate: Record<string, unknown> }
  | {
      action: 'COOLDOWN';
      nextState: string;
      slotsUpdate: Record<string, unknown>;
      nextContactAllowedAt: string;
    };

export type HandoffStatus = 'OPEN' | 'CLOSED';

export type HandoffCasePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type HandoffCase = {
  tenantId: string;
  caseId: string;
  debtorId: string;
  status: HandoffStatus;
  createdAtIso: string;
  updatedAtIso?: string;
  closedAtIso?: string;

  channel: Channel;
  intent: NluResult['intent'];
  confidence: number;
  stage: DebtorSnapshot['stage'];

  // Assignment (platform users are identified by email in MVP)
  assignedToEmail?: string;
  assignedAtIso?: string;

  // Ops metadata
  priority?: HandoffCasePriority;
  tags?: string[];

  // Optional, per tenant policy
  inboundText?: string;
};

export type ApiKeyStatus = 'ACTIVE' | 'DISABLED';

export type ApiKeyRecord = {
  keyId: string; // public id, stored and displayed
  label?: string; // optional display name (e.g., "Prod integration")
  status: ApiKeyStatus;
  createdAtIso: string;
  lastUsedAtIso?: string;
  // store only the hash (never the secret)
  hash: string;
};

export type ClientAuthConfig = {
  apiKeys: ApiKeyRecord[];
};

export type PlatformRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'OPERATOR' | 'CLIENT_ADMIN';
