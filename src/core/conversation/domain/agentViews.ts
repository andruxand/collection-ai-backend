import { z } from 'zod';

import { ContextPackV1Schema, SummaryMemorySchema } from './contextPackV1';

export const ClassifierViewSchema = z
  .object({
    meta: ContextPackV1Schema.shape.meta,
    tonePolicy: z.record(z.string()),
    summaryMemory: SummaryMemorySchema.optional(),
    lastTurns: ContextPackV1Schema.shape.lastTurns,
    input: ContextPackV1Schema.shape.input,
  })
  .strict();

export type ClassifierView = z.infer<typeof ClassifierViewSchema>;

export const PlannerViewSchema = z
  .object({
    pack: ContextPackV1Schema,
    classifier: z.record(z.unknown()),
  })
  .strict();

export type PlannerView = z.infer<typeof PlannerViewSchema>;

export const WriterViewSchema = z
  .object({
    meta: ContextPackV1Schema.shape.meta,
    tonePolicy: z.record(z.string()),
    input: ContextPackV1Schema.shape.input,
    summaryMemory: SummaryMemorySchema.optional(),
    lastTurns: ContextPackV1Schema.shape.lastTurns,
    plan: z.record(z.unknown()),
    classifier: z.record(z.unknown()),
    offersText: z.string().max(900).optional(),
    variantKey: z.enum(['A', 'B']).optional(),
  })
  .strict();

export type WriterView = z.infer<typeof WriterViewSchema>;

export const VerifierViewSchema = z
  .object({
    meta: ContextPackV1Schema.shape.meta,
    policyHardRules: z
      .object({
        noThreats: z.literal(true),
        noHallucinations: z.literal(true),
        noSensitivePii: z.literal(true),
      })
      .strict(),
    curatedPolicySnapshot: ContextPackV1Schema.shape.policySnapshot.shape.curatedPolicy.optional(),
    plan: z.record(z.unknown()),
    classifier: z.record(z.unknown()),
    debtSnapshot: ContextPackV1Schema.shape.debtSnapshot,
    writer: z.record(z.unknown()),
  })
  .strict();

export type VerifierView = z.infer<typeof VerifierViewSchema>;

export const SummarizerViewSchema = z
  .object({
    meta: ContextPackV1Schema.shape.meta,
    lastTurns: ContextPackV1Schema.shape.lastTurns,
    workingMemory: ContextPackV1Schema.shape.workingMemory,
    debtSnapshot: ContextPackV1Schema.shape.debtSnapshot,
    currentSummary: SummaryMemorySchema.optional(),
  })
  .strict();

export type SummarizerView = z.infer<typeof SummarizerViewSchema>;
