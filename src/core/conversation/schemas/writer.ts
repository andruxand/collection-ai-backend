import { z } from 'zod';

export const WriterOutputSchema = z
  .object({
    messageText: z.string().min(1).max(800),
    askUser: z.boolean().default(true),
    metadata: z
      .object({
        tone: z.string().min(1).max(40),
        languageVariant: z.string().min(2).max(16).default('es-CO'),
        includedSummary: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

export type WriterOutput = z.infer<typeof WriterOutputSchema>;

export const WRITER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['messageText', 'askUser', 'metadata'],
  properties: {
    messageText: { type: 'string' },
    askUser: { type: 'boolean' },
    metadata: {
      type: 'object',
      additionalProperties: false,
      required: ['tone', 'languageVariant', 'includedSummary'],
      properties: {
        tone: { type: 'string' },
        languageVariant: { type: 'string' },
        includedSummary: { type: 'boolean' },
      },
    },
  },
};
