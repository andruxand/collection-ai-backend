import type { Tenant, TenantPolicy, TenantStage } from '../types';

/**
 * Default policy values aligned with `TenantPolicy` in `src/core/types.ts`.
 * Tenants can store partial overrides; runtime merges with these defaults.
 */
export const DEFAULT_TENANT_POLICY: TenantPolicy = {
  contactPolicy: {
    timezone: 'America/Bogota',
    countryCode: 'CO',
    channelsAllowed: { whatsapp: true, telegram: true },
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

  cooldowns: {
    rejectedOfferDays: 2,
    noResponseDays: 3,
    brokenPromiseDays: 7,
  },

  offerPolicy: {
    ladder: [
      { attempt: 1, maxDiscountPct: 0 },
      { attempt: 2, maxDiscountPct: 5 },
      { attempt: 3, maxDiscountPct: 10 },
    ],
    maxAttempts: 6,
    hardCapDiscountPct: 20,
  },

  auditPolicy: {
    retentionDays: 180,
    storeMessageText: true,
    storeDecisionPayloads: true,
  },

  exportPolicy: {
    enabled: false,
  },

  notificationPolicy: {
    email: {
      enabled: false,
      fromAddress: '',
      toAddresses: [],
      subjectPrefix: '[CollectionsAI]',
      includeInboundText: false,
    },
  },

  handoffPolicy: {
    enabled: true,
    stageMin: 'MID',
    intents: ['DISPUTE', 'ANGRY'],
    retentionDays: 30,
    storeInboundText: true,
  },

  tonePolicy: {
    T1: 'Cordial y claro, tono informativo.',
    T2: 'Firme pero respetuoso, orientado a solución.',
    T3: 'Muy firme, centrado en opciones y consecuencias legales permitidas, sin amenazas.',
  },

  strategyPolicy: {
    // Conservative default: early cases get a softer nudge; otherwise aim to resolve via agreement.
    defaultObjective: 'NEGOTIATE',
    objectivePlaybook: {
      NUDGE: {
        goal: 'Orientar al usuario y lograr que elija una acción (detalle, acuerdo, pago hoy o promesa) sin presionar.',
        primaryAction: 'CLARIFY',
        secondaryAction: 'SHOW_DETAIL',
      },
      NEGOTIATE: {
        goal: 'Cerrar un acuerdo viable hoy (oferta/alternativa) y avanzar a pago o promesa.',
        primaryAction: 'SHOW_OFFERS',
        secondaryAction: 'ASK_SLOT',
      },
      COLLECT_NOW: {
        goal: 'Priorizar pago hoy si el usuario está dispuesto; si no, pasar a acuerdo rápidamente.',
        primaryAction: 'SEND_PAYMENT_LINK',
        secondaryAction: 'SHOW_OFFERS',
      },
      PROMISE: {
        goal: 'Capturar fecha y monto de promesa y registrarla.',
        primaryAction: 'ASK_SLOT',
        secondaryAction: 'CREATE_PROMISE',
      },
      VERIFY: {
        goal: 'Verificar pago o disputa antes de insistir con cobro.',
        primaryAction: 'ACK_ALREADY_PAID',
        secondaryAction: 'ACK_DISPUTE',
      },
    },
    rules: [
      {
        when: { maxDaysPastDue: 7 },
        objective: 'NUDGE',
        toneKey: 'T1',
      },
      {
        when: { minDaysPastDue: 60 },
        objective: 'COLLECT_NOW',
        toneKey: 'T3',
      },
      {
        when: { minTotalDueCop: 2000000 },
        objective: 'COLLECT_NOW',
        toneKey: 'T3',
      },
    ],
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMergeObjects(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch ?? base;

  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const bv = out[k];
    out[k] = isPlainObject(bv) && isPlainObject(v) ? deepMergeObjects(bv, v) : v;
  }
  return out;
}

export function mergeTenantPolicy(override: unknown): TenantPolicy {
  const patch = typeof override === 'object' && override !== null ? override : {};
  return deepMergeObjects(DEFAULT_TENANT_POLICY, patch) as TenantPolicy;
}

export function withTenantDefaults(input: Tenant): Tenant {
  const merged = mergeTenantPolicy(input.policy ?? {});

  // Defensive: if a tenant stores an unknown stageMin, coerce to a safe default.
  const stageMin = merged.handoffPolicy?.stageMin;
  const allowedStages: TenantStage[] = ['EARLY', 'MID', 'LATE'];
  if (!allowedStages.includes(stageMin)) {
    merged.handoffPolicy.stageMin = 'MID';
  }

  return { ...input, policy: merged };
}
