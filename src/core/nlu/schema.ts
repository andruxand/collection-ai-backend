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
      amountCop: z.number().int().positive().optional(),
      dateIso: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      paymentMethod: z.enum(['PSE', 'CARD', 'TRANSFER', 'CASH']).optional(),
      offerIndex: z.number().int().positive().optional(),
    })
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
        amountCop: { type: 'integer' },
        dateIso: { type: 'string' },
        paymentMethod: { type: 'string', enum: ['PSE', 'CARD', 'TRANSFER', 'CASH'] },
        offerIndex: { type: 'integer' },
      },
      additionalProperties: false,
    },
    confidence: { type: 'number' },
    topicShift: { type: 'boolean' },
  },
  required: ['intent', 'entities', 'confidence', 'topicShift'],
  additionalProperties: false,
} as const;
