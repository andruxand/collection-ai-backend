import { z } from 'zod';

export const ClassifierIntentSchema = z.enum([
  'PAY_NOW',
  'PAY_LATER',
  'CANT_PAY',
  'DISPUTE',
  'WRONG_PERSON',
  'OFF_TOPIC',
  'ABUSIVE',
  'INFO_REQUEST',
  'UNKNOWN',
]);

export const ConversationModeSchema = z.enum([
  'NEGOTIATION',
  'DISPUTE',
  'WRONG_PERSON',
  'ABUSE_DEESCALATION',
  'HUMAN_HANDOFF',
]);

export const PaymentMethodSchema = z.enum(['PSE', 'CARD', 'TRANSFER', 'CASH']);

export const ClassifierEntitiesSchema = z
  .object({
    // NOTE: OpenAI Structured Outputs (json_schema strict) requires that every property exists.
    // We therefore allow null for "unknown" values and keep optional for backward-compat.
    amountCop: z.number().int().positive().nullable().optional(),
    dateIso: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    paymentMethod: PaymentMethodSchema.nullable().optional(),
    personName: z.string().min(1).max(120).nullable().optional(),
    idDoc: z.string().min(3).max(32).nullable().optional(),
  })
  .strict();

export const ClassifierFlagsSchema = z
  .object({
    ambiguousAmount: z.boolean().default(false),
    ambiguousDate: z.boolean().default(false),
    contradiction: z.boolean().default(false),
    lowContext: z.boolean().default(false),
    sensitiveRequest: z.boolean().default(false),
    requiresHuman: z.boolean().default(false),
  })
  .strict();

export const ClassifierOutputSchema = z
  .object({
    intent: ClassifierIntentSchema,
    mode: ConversationModeSchema,
    modeConfidence: z.number().min(0).max(1),
    modeRationale: z.string().min(1).max(180),
    entities: ClassifierEntitiesSchema.default({}),
    flags: ClassifierFlagsSchema.default({
      ambiguousAmount: false,
      ambiguousDate: false,
      contradiction: false,
      lowContext: false,
      sensitiveRequest: false,
      requiresHuman: false,
    }),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(280),
  })
  .strict();

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

export const CLASSIFIER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent',
    'mode',
    'modeConfidence',
    'modeRationale',
    'entities',
    'flags',
    'confidence',
    'rationale',
  ],
  properties: {
    intent: {
      type: 'string',
      enum: [
        'PAY_NOW',
        'PAY_LATER',
        'CANT_PAY',
        'DISPUTE',
        'WRONG_PERSON',
        'OFF_TOPIC',
        'ABUSIVE',
        'INFO_REQUEST',
        'UNKNOWN',
      ],
    },
    mode: {
      type: 'string',
      enum: ['NEGOTIATION', 'DISPUTE', 'WRONG_PERSON', 'ABUSE_DEESCALATION', 'HUMAN_HANDOFF'],
    },
    modeConfidence: { type: 'number', minimum: 0, maximum: 1 },
    modeRationale: { type: 'string' },
    entities: {
      type: 'object',
      additionalProperties: false,
      properties: {
        amountCop: { type: ['integer', 'null'], minimum: 1 },
        dateIso: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        paymentMethod: { type: ['string', 'null'], enum: ['PSE', 'CARD', 'TRANSFER', 'CASH'] },
        personName: { type: ['string', 'null'] },
        idDoc: { type: ['string', 'null'] },
      },
      required: ['amountCop', 'dateIso', 'paymentMethod', 'personName', 'idDoc'],
    },
    flags: {
      type: 'object',
      additionalProperties: false,
      required: [
        'ambiguousAmount',
        'ambiguousDate',
        'contradiction',
        'lowContext',
        'sensitiveRequest',
        'requiresHuman',
      ],
      properties: {
        ambiguousAmount: { type: 'boolean' },
        ambiguousDate: { type: 'boolean' },
        contradiction: { type: 'boolean' },
        lowContext: { type: 'boolean' },
        sensitiveRequest: { type: 'boolean' },
        requiresHuman: { type: 'boolean' },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
  },
};
