import { z } from 'zod';

import { NluSchema } from '../nlu/schema';

const ConversationStateEnum = z.enum([
  'WELCOME',
  'DETAIL',
  'OFFER_MENU',
  'NEGOTIATION',
  'PAYMENT',
  'REMINDERS',
  'COOLDOWN',
  'DONE',
  'HANDOFF',
]);

const SlotsUpdateSchema = z.record(z.unknown()).default({});

const NbaBaseSchema = z.object({
  nextState: ConversationStateEnum,
  slotsUpdate: SlotsUpdateSchema,
});

const NbaSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('OPT_OUT'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('ACK_ALREADY_PAID'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('ACK_DISPUTE'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('DEESCALATE'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('PERSUADE'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('END_REFUSAL'),
      // Filled deterministically; LLM may omit it.
      nextContactAllowedAt: z.string().optional(),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('GREET'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('CLARIFY'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('REDIRECT_MENU'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('ASK_SLOT'),
      slot: z.enum(['promiseDate', 'promiseAmount', 'paymentMethod']),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('SHOW_DETAIL'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('SHOW_OFFERS'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('SEND_PAYMENT_LINK'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('PROACTIVE_OUTREACH'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('CREATE_PROMISE'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('FALLBACK_MENU'),
    })
    .merge(NbaBaseSchema),
  z
    .object({
      action: z.literal('COOLDOWN'),
      // Filled deterministically; LLM may omit it.
      nextContactAllowedAt: z.string().optional(),
    })
    .merge(NbaBaseSchema),
]);

export const DialogueDecisionSchema = z.object({
  nlu: NluSchema,
  nba: NbaSchema,
  // Optional: we may choose to use the deterministic writer instead.
  messageDraft: z.string().min(1).max(1200).optional(),
  confidence: z.number().min(0).max(1).default(0.6),
  rationale: z.string().max(800).optional(),
});

export type DialogueDecision = z.infer<typeof DialogueDecisionSchema>;

// Hand-written JSON Schema for OpenAI strict output
export const DIALOGUE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    nlu: {
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
    },
    nba: {
      anyOf: [
        {
          type: 'object',
          properties: {
            action: { const: 'OPT_OUT' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'ACK_ALREADY_PAID' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'ACK_DISPUTE' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'DEESCALATE' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'PERSUADE' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'END_REFUSAL' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
            nextContactAllowedAt: { type: 'string' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'GREET' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'CLARIFY' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'REDIRECT_MENU' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'ASK_SLOT' },
            slot: { type: 'string', enum: ['promiseDate', 'promiseAmount', 'paymentMethod'] },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'slot', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'SHOW_DETAIL' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'SHOW_OFFERS' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'SEND_PAYMENT_LINK' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'PROACTIVE_OUTREACH' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'CREATE_PROMISE' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'FALLBACK_MENU' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'COOLDOWN' },
            nextState: { type: 'string' },
            slotsUpdate: { type: 'object' },
            nextContactAllowedAt: { type: 'string' },
          },
          required: ['action', 'nextState', 'slotsUpdate'],
          additionalProperties: false,
        },
      ],
    },
    messageDraft: { type: 'string' },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['nlu', 'nba'],
  additionalProperties: false,
} as const;
