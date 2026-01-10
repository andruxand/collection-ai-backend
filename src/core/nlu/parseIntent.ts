import { llmJson } from '../llm/llmClient';
import { NLU_PROMPT } from '../llm/prompts';
import type { NluResult } from '../types';
import { NLU_JSON_SCHEMA, NluSchema } from './schema';

function regexFallback(text: string): NluResult {
  const t = text.toLowerCase();
  if (/(no.*(llam|escrib)|no me contact|paren|stop)/.test(t))
    return { intent: 'OPT_OUT', entities: {}, confidence: 0.7, topicShift: false };
  if (/(ya pag|pag(ue|ué)|transferí)/.test(t))
    return { intent: 'ALREADY_PAID', entities: {}, confidence: 0.7, topicShift: false };
  if (/(link|pse|tarjeta|pago hoy|pagar hoy)/.test(t))
    return { intent: 'PAY_NOW', entities: {}, confidence: 0.55, topicShift: false };
  if (/(acuerdo|cuotas|negoci|descuento)/.test(t))
    return { intent: 'NEGOTIATE', entities: {}, confidence: 0.55, topicShift: false };
  if (/(no debo|equivoc|fraude|estafa|no es mi)/.test(t))
    return { intent: 'DISPUTE', entities: {}, confidence: 0.6, topicShift: false };
  return { intent: 'UNKNOWN', entities: {}, confidence: 0.2, topicShift: false };
}

export async function parseIntent(input: { text: string }): Promise<NluResult> {
  const prompt = NLU_PROMPT.replace('{{text}}', input.text);
  try {
    const raw = await llmJson(prompt, NLU_JSON_SCHEMA, 'nlu');
    const parsed = NluSchema.safeParse(raw);
    if (!parsed.success) return regexFallback(input.text);
    return parsed.data as NluResult;
  } catch {
    return regexFallback(input.text);
  }
}
