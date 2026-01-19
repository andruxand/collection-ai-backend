import { z } from 'zod';

export const EvaluatorSelectedVariantSchema = z.enum(['A', 'B']);

export const EvaluatorScoresSchema = z
  .object({
    A: z.number().int().min(0).max(100),
    B: z.number().int().min(0).max(100),
  })
  .strict();

export const EvaluatorOutputSchema = z
  .object({
    selectedVariant: EvaluatorSelectedVariantSchema,
    scores: EvaluatorScoresSchema,
    rationale: z.string().min(1).max(400),
  })
  .strict();

export type EvaluatorOutput = z.infer<typeof EvaluatorOutputSchema>;

export const EVALUATOR_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['selectedVariant', 'scores', 'rationale'],
  properties: {
    selectedVariant: { type: 'string', enum: ['A', 'B'] },
    scores: {
      type: 'object',
      additionalProperties: false,
      required: ['A', 'B'],
      properties: {
        A: { type: 'integer', minimum: 0, maximum: 100 },
        B: { type: 'integer', minimum: 0, maximum: 100 },
      },
    },
    rationale: { type: 'string' },
  },
};
