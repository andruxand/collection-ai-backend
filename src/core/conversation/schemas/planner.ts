import { z } from 'zod';

export const PlannerActionTypeSchema = z.enum([
  'ASK_SLOT',
  'OFFER_OPTIONS',
  'CONFIRM',
  'REDIRECT',
  'ESCALATE',
  'END',
  'INFORM',
  'INFORM_TEMPLATE',
]);

export const PlannerTemplateVarsSchema = z
  .object({
    amount: z.union([z.number().int().positive(), z.string().min(1).max(80)]).optional(),
    date: z.string().min(1).max(32).optional(),
    method: z.string().min(1).max(40).optional(),
    link: z.string().min(1).max(240).optional(),
    hours: z.string().min(1).max(240).optional(),
    supportContact: z.string().min(1).max(160).optional(),
  })
  .strict();

export const PlannerTargetSlotSchema = z.enum([
  'identityConfirmed',
  'paymentAbility',
  'commitAmount',
  'commitDate',
  'paymentMethod',
  'preferredContactTime',
]);

export const BudgetsSnapshotSchema = z
  .object({
    maxNegotiationRounds: z.number().int().nonnegative(),
    maxSlotAsksPerSlot: z.number().int().nonnegative(),
    maxOffTopicRedirects: z.number().int().nonnegative(),
    abuseStrikeLimit: z.number().nonnegative(),
    maxRepairAttempts: z.number().int().nonnegative(),
    counters: z
      .object({
        negotiationRounds: z.number().int().nonnegative().default(0),
        offTopicRedirects: z.number().int().nonnegative().default(0),
        abuseStrikes: z.number().nonnegative().default(0),
        repairAttempts: z.number().int().nonnegative().default(0),
        slotAsks: z.record(z.number().int().nonnegative()).default({}),
      })
      .strict(),
  })
  .strict();

export const PlannerOutputSchema = z
  .object({
    actionType: PlannerActionTypeSchema,
    targetSlot: PlannerTargetSlotSchema.optional(),
    question: z.string().min(1).max(240).optional(),
    options: z.array(z.string().min(1).max(120)).min(2).max(3).optional(),
    templateId: z.string().min(1).max(80).optional(),
    templateVars: PlannerTemplateVarsSchema.optional(),
    summaryToConfirm: z
      .object({
        amountCop: z.number().int().positive(),
        dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        paymentMethod: z.string().min(2).max(32),
      })
      .strict()
      .optional(),
    stateBefore: z.string().min(1).max(64),
    stateAfter: z.string().min(1).max(64),
    budgetsSnapshot: BudgetsSnapshotSchema,
    complianceNotes: z.array(z.string().min(1).max(200)).max(12).default([]),
  })
  .strict();

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export const PLANNER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actionType', 'stateBefore', 'stateAfter', 'budgetsSnapshot', 'complianceNotes'],
  properties: {
    actionType: {
      type: 'string',
      enum: [
        'ASK_SLOT',
        'OFFER_OPTIONS',
        'CONFIRM',
        'REDIRECT',
        'ESCALATE',
        'END',
        'INFORM',
        'INFORM_TEMPLATE',
      ],
    },
    targetSlot: {
      type: 'string',
      enum: [
        'identityConfirmed',
        'paymentAbility',
        'commitAmount',
        'commitDate',
        'paymentMethod',
        'preferredContactTime',
      ],
    },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
    templateId: { type: 'string' },
    templateVars: {
      type: 'object',
      additionalProperties: false,
      properties: {
        amount: {},
        date: { type: 'string' },
        method: { type: 'string' },
        link: { type: 'string' },
        hours: { type: 'string' },
        supportContact: { type: 'string' },
      },
    },
    summaryToConfirm: {
      type: 'object',
      additionalProperties: false,
      required: ['amountCop', 'dateIso', 'paymentMethod'],
      properties: {
        amountCop: { type: 'integer', minimum: 1 },
        dateIso: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        paymentMethod: { type: 'string' },
      },
    },
    stateBefore: { type: 'string' },
    stateAfter: { type: 'string' },
    budgetsSnapshot: {
      type: 'object',
      additionalProperties: false,
      required: [
        'maxNegotiationRounds',
        'maxSlotAsksPerSlot',
        'maxOffTopicRedirects',
        'abuseStrikeLimit',
        'maxRepairAttempts',
        'counters',
      ],
      properties: {
        maxNegotiationRounds: { type: 'integer', minimum: 0 },
        maxSlotAsksPerSlot: { type: 'integer', minimum: 0 },
        maxOffTopicRedirects: { type: 'integer', minimum: 0 },
        abuseStrikeLimit: { type: 'number', minimum: 0 },
        maxRepairAttempts: { type: 'integer', minimum: 0 },
        counters: {
          type: 'object',
          additionalProperties: false,
          required: [
            'negotiationRounds',
            'offTopicRedirects',
            'abuseStrikes',
            'repairAttempts',
            'slotAsks',
          ],
          properties: {
            negotiationRounds: { type: 'integer', minimum: 0 },
            offTopicRedirects: { type: 'integer', minimum: 0 },
            abuseStrikes: { type: 'number', minimum: 0 },
            repairAttempts: { type: 'integer', minimum: 0 },
            slotAsks: {
              type: 'object',
              additionalProperties: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
    complianceNotes: { type: 'array', items: { type: 'string' } },
  },
};
