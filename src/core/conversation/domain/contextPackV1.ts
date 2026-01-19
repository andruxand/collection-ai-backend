import { z } from 'zod';

export const ContextPackMetaSchema = z
  .object({
    version: z.literal('ContextPack/v1'),
    tenantId: z.string().min(1),
    debtorId: z.string().min(1),
    channel: z.enum(['whatsapp', 'telegram']),
    atIso: z.string().min(10),
    turnId: z.string().min(1),
    conversationState: z.string().min(1),
  })
  .strict();

export const ContextPackInputSchema = z
  .object({
    userTextRaw: z.string().min(0),
    userTextNormalized: z.string().min(0),
    candidates: z
      .object({
        amountCop: z.number().int().positive().optional(),
        dateIso: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        paymentMethod: z.string().min(2).max(32).optional(),
        ambiguousAmount: z.boolean().default(false),
        ambiguousDate: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

export const SummaryMemorySchema = z
  .object({
    bullets: z.array(z.string().min(1).max(160)).max(8),
    updatedAtIso: z.string().min(10),
    updatedAtTurnCount: z.number().int().nonnegative(),
  })
  .strict();

export const ContextPackV1Schema = z
  .object({
    meta: ContextPackMetaSchema,
    tenantConfig: z
      .object({
        tonePolicy: z.record(z.string()),
        handoffEnabled: z.boolean(),
      })
      .strict(),
    debtSnapshot: z
      .object({
        totalDueCop: z.number().int().nonnegative(),
        daysPastDue: z.number().int().nonnegative(),
        stage: z.enum(['EARLY', 'MID', 'LATE']),
      })
      .strict(),
    policySnapshot: z
      .object({
        maxRepairAttempts: z.number().int().nonnegative(),
        budgets: z
          .object({
            maxNegotiationRounds: z.number().int().nonnegative(),
            maxSlotAsksPerSlot: z.number().int().nonnegative(),
            maxOffTopicRedirects: z.number().int().nonnegative(),
            abuseStrikeLimit: z.number().nonnegative(),
          })
          .strict(),

        /** Curated compliance ruleset (country baseline, optionally future tenant overrides). */
        curatedPolicy: z
          .object({
            countryCode: z.string().min(2).max(4),
            policyVersion: z.string().min(4).max(32),
            effectiveDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            lastReviewedAtIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            hardRules: z.array(z.string().min(1).max(220)).max(20),
            softGuidelines: z.array(z.string().min(1).max(220)).max(20),
            complianceNotes: z.array(z.string().min(1).max(64)).max(24),
            disclaimers: z.array(z.string().min(1).max(220)).max(12),
            sourceRefsMinimal: z
              .array(
                z
                  .object({
                    title: z.string().min(1).max(140),
                    url: z.string().url().max(500),
                  })
                  .strict()
              )
              .max(10),
            missingFallbackUsed: z.boolean().optional(),
          })
          .strict(),
      })
      .strict(),

    /** Runtime budgets including counters (may evolve turn-by-turn). */
    budgetsRuntime: z
      .object({
        maxNegotiationRounds: z.number().int().nonnegative(),
        maxSlotAsksPerSlot: z.number().int().nonnegative(),
        maxOffTopicRedirects: z.number().int().nonnegative(),
        abuseStrikeLimit: z.number().nonnegative(),
        maxRepairAttempts: z.number().int().nonnegative(),
        counters: z
          .object({
            negotiationRounds: z.number().int().nonnegative(),
            offTopicRedirects: z.number().int().nonnegative(),
            abuseStrikes: z.number().nonnegative(),
            repairAttempts: z.number().int().nonnegative(),
            slotAsks: z.record(z.number().int().nonnegative()),
          })
          .strict(),
      })
      .strict(),
    workingMemory: z.record(z.unknown()).default({}),
    summaryMemory: SummaryMemorySchema.optional(),
    lastTurns: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            atIso: z.string().min(10),
            text: z.string().max(260).optional(),
          })
          .strict()
      )
      .max(12),
    input: ContextPackInputSchema,
  })
  .strict();

export type ContextPackV1 = z.infer<typeof ContextPackV1Schema>;
export type SummaryMemory = z.infer<typeof SummaryMemorySchema>;
