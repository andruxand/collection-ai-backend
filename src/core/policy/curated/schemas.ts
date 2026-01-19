import { z } from 'zod';

export const CountryCodeSchema = z
  .string()
  .min(2)
  .max(4)
  .transform((v) => v.toUpperCase());

export const CuratedPolicyEscalationActionSchema = z.enum([
  'HUMAN_HANDOFF',
  'END',
  'ASK_VERIFICATION',
]);

export const CuratedPolicyEscalationRuleSchema = z
  .object({
    triggers: z.array(z.string().min(1).max(64)).min(1).max(10),
    action: CuratedPolicyEscalationActionSchema,
  })
  .strict();

export const CuratedPolicyDefinitionSchema = z
  .object({
    countryCode: CountryCodeSchema,
    policyVersion: z.string().min(4).max(32),
    effectiveDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    lastReviewedAtIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

    hardRules: z.array(z.string().min(1).max(220)).max(60),
    softGuidelines: z.array(z.string().min(1).max(220)).max(60),
    disclaimers: z.array(z.string().min(1).max(220)).max(24),

    escalationRules: z.array(CuratedPolicyEscalationRuleSchema).max(24),
    sourceRefs: z.array(z.string().min(1).max(64)).max(40),
  })
  .strict();

export type CuratedPolicyDefinition = z.infer<typeof CuratedPolicyDefinitionSchema>;

export const SourceRegistryItemSchema = z
  .object({
    sourceId: z.string().min(1).max(64),
    title: z.string().min(1).max(140),
    url: z.string().url().max(500),
    publisher: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    publishedDateIso: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    lastCheckedAtIso: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    notes: z.string().min(1).max(220).optional(),
  })
  .strict();

export type SourceRegistryItem = z.infer<typeof SourceRegistryItemSchema>;

export const SourceRefsMinimalSchema = z
  .array(
    z
      .object({
        title: z.string().min(1).max(140),
        url: z.string().url().max(500),
      })
      .strict()
  )
  .max(10);

export const CuratedPolicySnapshotSchema = z
  .object({
    countryCode: CountryCodeSchema,
    policyVersion: z.string().min(4).max(32),
    effectiveDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    lastReviewedAtIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

    hardRules: z.array(z.string().min(1).max(220)).max(20),
    softGuidelines: z.array(z.string().min(1).max(220)).max(20),
    disclaimers: z.array(z.string().min(1).max(220)).max(12),

    /** Machine-oriented notes/tags used for deterministic enforcement and audit. */
    complianceNotes: z.array(z.string().min(1).max(64)).max(24),

    sourceRefsMinimal: SourceRefsMinimalSchema,

    /** True if we couldn't load a curated policy and used the baseline safe fallback. */
    missingFallbackUsed: z.boolean().optional(),
  })
  .strict();

export type CuratedPolicySnapshot = z.infer<typeof CuratedPolicySnapshotSchema>;
