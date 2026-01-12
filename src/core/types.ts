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

export type StrategyObjective = 'COLLECT_NOW' | 'NEGOTIATE' | 'PROMISE' | 'NUDGE' | 'VERIFY';

export type StrategyPreferredAction =
  | 'SEND_PAYMENT_LINK'
  | 'SHOW_OFFERS'
  | 'ASK_SLOT'
  | 'CREATE_PROMISE'
  | 'SHOW_DETAIL'
  | 'CLARIFY'
  | 'DEESCALATE'
  | 'ACK_DISPUTE'
  | 'ACK_ALREADY_PAID';

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

  /** Optional: per-tenant conversational goals and tone strategy. */
  strategyPolicy?: {
    /** Default objective if no rule matches. */
    defaultObjective?: StrategyObjective;

    /** Optional: per-objective playbooks used by the Dialogue Manager to guide towards closure. */
    objectivePlaybook?: Partial<
      Record<
        StrategyObjective,
        {
          /** Human-readable goal for the DM (do not expose internal policy). */
          goal: string;
          /** Preferred first action when the user is ready. */
          primaryAction?: StrategyPreferredAction;
          /** Preferred fallback if primary is not accepted. */
          secondaryAction?: StrategyPreferredAction;
        }
      >
    >;

    /** Ordered rules; first match wins. */
    rules?: Array<{
      when: {
        minDaysPastDue?: number;
        maxDaysPastDue?: number;
        minTotalDueCop?: number;
        maxTotalDueCop?: number;
        stages?: TenantStage[];
      };
      objective: StrategyObjective;
      /** Optional: override tone using existing tonePolicy buckets. */
      toneKey?: 'T1' | 'T2' | 'T3';
      /** Optional: explicit tone string override. */
      tone?: string;
    }>;
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
    | 'GREETING'
    | 'AFFIRM'
    | 'DENY'
    | 'SELECT_OFFER'
    | 'REFUSE_PAY'
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
    offerIndex?: number;
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
  | { action: 'ACK_ALREADY_PAID'; nextState: string; slotsUpdate: Record<string, unknown> }
  | { action: 'ACK_DISPUTE'; nextState: string; slotsUpdate: Record<string, unknown> }
  | { action: 'DEESCALATE'; nextState: string; slotsUpdate: Record<string, unknown> }
  | { action: 'PERSUADE'; nextState: string; slotsUpdate: Record<string, unknown> }
  | {
      action: 'END_REFUSAL';
      nextState: string;
      slotsUpdate: Record<string, unknown>;
      nextContactAllowedAt: string;
    }
  | { action: 'GREET'; nextState: string; slotsUpdate: Record<string, unknown> }
  | { action: 'CLARIFY'; nextState: string; slotsUpdate: Record<string, unknown> }
  | { action: 'REDIRECT_MENU'; nextState: string; slotsUpdate: Record<string, unknown> }
  | {
      action: 'ASK_SLOT';
      nextState: string;
      slotsUpdate: Record<string, unknown>;
      slot: 'promiseDate' | 'promiseAmount' | 'paymentMethod';
    }
  | { action: 'SHOW_DETAIL'; nextState: string; slotsUpdate: Record<string, unknown> }
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
