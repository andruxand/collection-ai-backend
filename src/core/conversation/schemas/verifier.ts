import { z } from 'zod';

export const VerifierStatusSchema = z.enum(['PASS', 'FAIL']);

export const VerifierIssueSchema = z.enum([
  'HALLUCINATION',
  'POLICY_VIOLATION',
  'MISSING_REQUIRED_SLOT',
  'TONE_PROBLEM',
  'TOO_LONG',
  'NOT_MATCHING_PLAN',
]);

export const VerifierOutputSchema = z
  .object({
    status: VerifierStatusSchema,
    issues: z.array(VerifierIssueSchema).max(12).default([]),
    repairInstructions: z.string().max(600).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.status === 'FAIL' &&
      (!val.repairInstructions || val.repairInstructions.trim().length < 3)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'repairInstructions is required when status=FAIL',
        path: ['repairInstructions'],
      });
    }
  });

export type VerifierOutput = z.infer<typeof VerifierOutputSchema>;

export const VERIFIER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'issues'],
  properties: {
    status: { type: 'string', enum: ['PASS', 'FAIL'] },
    issues: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'HALLUCINATION',
          'POLICY_VIOLATION',
          'MISSING_REQUIRED_SLOT',
          'TONE_PROBLEM',
          'TOO_LONG',
          'NOT_MATCHING_PLAN',
        ],
      },
    },
    repairInstructions: { type: 'string' },
  },
};
