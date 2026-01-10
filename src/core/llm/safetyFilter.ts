import { z } from 'zod';

import { llmJson } from './llmClient';
import { SAFETY_PROMPT } from './prompts';

const SafetySchema = z.object({
  safe: z.boolean(),
  rewrite: z.string().optional(),
});

const RED_FLAGS = [/c[aá]rcel/i, /embarg/i, /demand/i, /visita/i, /polic/i];

export async function safetyFilter(input: { text: string }): Promise<string> {
  // Cheap first-pass rules (MVP)
  if (RED_FLAGS.some((r) => r.test(input.text))) {
    return 'Para evitar malentendidos, puedo ayudarte a definir una alternativa de pago. ¿Prefieres pagar hoy o hacer un acuerdo en cuotas?';
  }

  // Optional LLM safety check (requires LLM configured)
  try {
    const raw = await llmJson(SAFETY_PROMPT.replace('{{text}}', input.text));
    const parsed = SafetySchema.safeParse(raw);
    if (parsed.success && parsed.data.safe) return input.text;
    if (parsed.success && !parsed.data.safe && parsed.data.rewrite) return parsed.data.rewrite;
    return input.text;
  } catch {
    return input.text;
  }
}
