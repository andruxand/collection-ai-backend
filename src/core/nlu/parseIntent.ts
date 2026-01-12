import { llmJson } from '../llm/llmClient';
import { NLU_PROMPT } from '../llm/prompts';
import type { NluResult } from '../types';
import { NLU_JSON_SCHEMA, NluSchema } from './schema';

function deterministicMenuIntent(text: string): NluResult | undefined {
  const t = text.trim().toLowerCase();

  // Greeting / start commands (Telegram etc.)
  if (
    t === '/start' ||
    /^(hola|buenas|buenos\s+d[ií]as|buen\s+d[ií]a|buenas\s+tardes|buenas\s+noches|hey|hi)\b/.test(
      t
    )
  ) {
    return { intent: 'GREETING', entities: {}, confidence: 0.95, topicShift: false };
  }

  // Main menu shortcuts (responseWriter: 1) Ver detalle, 2) Hacer acuerdo, 3) Pagar hoy, 4) Prometer fecha
  const m = t.match(/^(?:opci[oó]n\s*)?([1-4])(?:[\).:\-\s].*)?$/i);
  if (m?.[1] === '1')
    return { intent: 'ASK_DETAIL', entities: {}, confidence: 0.95, topicShift: false };
  if (m?.[1] === '2')
    return { intent: 'NEGOTIATE', entities: {}, confidence: 0.95, topicShift: false };
  if (m?.[1] === '3')
    return { intent: 'PAY_NOW', entities: {}, confidence: 0.95, topicShift: false };
  if (m?.[1] === '4')
    return { intent: 'PROMISE_PAYMENT', entities: {}, confidence: 0.95, topicShift: false };

  if (/(ver\s+detalle|detalle|informaci[oó]n|saldo|cu[aá]nto\s+debo)/.test(t)) {
    return { intent: 'ASK_DETAIL', entities: {}, confidence: 0.75, topicShift: false };
  }

  if (
    /(promesa|prometer|fecha\s+de\s+pago|pago\s+el\s+\d{4}-\d{2}-\d{2}|pagar\s+el\s+\d{4}-\d{2}-\d{2})/.test(
      t
    )
  ) {
    return { intent: 'PROMISE_PAYMENT', entities: {}, confidence: 0.65, topicShift: false };
  }

  return undefined;
}

function regexFallback(text: string): NluResult {
  const t = text.toLowerCase();
  if (
    t.trim() === '/start' ||
    /^(hola|buenas|buenos\s+d[ií]as|buen\s+d[ií]a|buenas\s+tardes|buenas\s+noches|hey|hi)\b/.test(
      t.trim()
    )
  )
    return { intent: 'GREETING', entities: {}, confidence: 0.6, topicShift: false };
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
  const deterministic = deterministicMenuIntent(input.text);
  if (deterministic) return deterministic;

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
