import { z } from 'zod';

export const NluSchema = z.object({
  intent: z.enum([
    'GREETING',
    'AFFIRM',
    'DENY',
    'SELECT_OFFER',
    'REFUSE_PAY',
    'PAY_NOW',
    'NEGOTIATE',
    'PROMISE_PAYMENT',
    'ASK_DETAIL',
    'DISPUTE',
    'ALREADY_PAID',
    'OPT_OUT',
    'ANGRY',
    'OFFTOPIC',
    'UNKNOWN',
  ]),
  entities: z
    .object({
      // OpenAI strict output schemas require presence; allow null when unknown.
      amountCop: z.number().int().positive().nullable().optional(),
      dateIso: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
      paymentMethod: z.enum(['PSE', 'CARD', 'TRANSFER', 'CASH']).nullable().optional(),
      offerIndex: z.number().int().positive().nullable().optional(),
    })
    .strict()
    .default({}),
  confidence: z.number().min(0).max(1).default(0.5),
  topicShift: z.boolean().default(false),
});

export const NLU_JSON_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'GREETING',
        'AFFIRM',
        'DENY',
        'SELECT_OFFER',
        'REFUSE_PAY',
        'PAY_NOW',
        'NEGOTIATE',
        'PROMISE_PAYMENT',
        'ASK_DETAIL',
        'DISPUTE',
        'ALREADY_PAID',
        'OPT_OUT',
        'ANGRY',
        'OFFTOPIC',
        'UNKNOWN',
      ],
    },
    entities: {
      type: 'object',
      properties: {
        amountCop: { type: ['integer', 'null'] },
        dateIso: { type: ['string', 'null'] },
        paymentMethod: { type: ['string', 'null'], enum: ['PSE', 'CARD', 'TRANSFER', 'CASH'] },
        offerIndex: { type: ['integer', 'null'] },
      },
      required: ['amountCop', 'dateIso', 'paymentMethod', 'offerIndex'],
      additionalProperties: false,
    },
    confidence: { type: 'number' },
    topicShift: { type: 'boolean' },
  },
  required: ['intent', 'entities', 'confidence', 'topicShift'],
  additionalProperties: false,
} as const;
