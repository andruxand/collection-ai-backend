import { DateTime } from 'luxon';

import { llmJson } from '../llm/llmClient';
import { NLU_PROMPT } from '../llm/prompts';
import type { ConversationState, NluResult } from '../types';
import { NLU_JSON_SCHEMA, NluSchema } from './schema';

function normalizeCopAmount(raw: string): number | undefined {
  const cleaned = raw.replace(/[^0-9]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function extractAmountCop(text: string): number | undefined {
  const t = text.toLowerCase().trim();

  // Common colloquialisms: "20 mil", "20mil", "20k", "20.000", "20 000"... etc.
  // Order matters: prefer explicit multipliers over plain numbers.
  const withMultiplier = t.match(
    /\b(\d{1,3}(?:[\.\s]\d{3})+|\d+(?:[\.,]\d+)?)\s*(mil|k|m|mill[oó]n(?:es)?)\b/
  );
  if (withMultiplier) {
    const rawNumber = withMultiplier[1].replace(/\s/g, '');
    const base = Number(rawNumber.replace(/\./g, '').replace(/,/g, '.'));
    if (!Number.isFinite(base) || base <= 0) return undefined;
    const mult = withMultiplier[2];
    const factor =
      mult === 'mil' || mult === 'k'
        ? 1_000
        : mult === 'm' || mult.startsWith('mill')
        ? 1_000_000
        : 1;
    const value = Math.round(base * factor);
    return value > 0 ? value : undefined;
  }

  const amountMatch = t.match(/\$?\s*(\d{1,3}(?:[\.\s]\d{3})+|\d{4,})\s*(?:cop)?\b/);
  if (amountMatch?.[1]) return normalizeCopAmount(amountMatch[1]);
  return undefined;
}

function nextWeekdayDateIso(params: { now: DateTime; weekday: number }): string {
  // Luxon weekday: 1=Mon ... 7=Sun
  const delta = (params.weekday - params.now.weekday + 7) % 7;
  const daysToAdd = delta === 0 ? 7 : delta;
  return params.now.plus({ days: daysToAdd }).toISODate()!;
}

function extractDateIso(text: string): string | undefined {
  const t = text.trim();
  const lower = t.toLowerCase();

  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso?.[1]) return iso[1];

  const dmy = t.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (dmy) {
    const dd = String(dmy[1]).padStart(2, '0');
    const mm = String(dmy[2]).padStart(2, '0');
    const yyyy = dmy[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // Relative dates (Spanish)
  const now = DateTime.now().setZone('America/Bogota');
  if (/\bhoy\b/.test(lower)) return now.toISODate()!;
  if (/\bma[nñ]ana\b/.test(lower)) return now.plus({ days: 1 }).toISODate()!;

  // Weekdays (Spanish)
  const weekdayMap: Record<string, number> = {
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
    domingo: 7,
  };

  const wd = lower.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/);
  if (wd?.[1]) {
    const weekday = weekdayMap[wd[1]];
    if (weekday) return nextWeekdayDateIso({ now, weekday });
  }

  return undefined;
}

function extractEntities(text: string): NluResult['entities'] {
  const t = text.toLowerCase();

  const amountCop = extractAmountCop(text);

  const dateIso = extractDateIso(text);

  const paymentMethod = (() => {
    if (/\bpse\b/.test(t)) return 'PSE' as const;
    if (/(tarjeta|cr[eé]dito|debito|d[eé]bito)/.test(t)) return 'CARD' as const;
    if (/(transfer|banco|nequi|daviplata)/.test(t)) return 'TRANSFER' as const;
    if (/(efectivo|cash)/.test(t)) return 'CASH' as const;
    return undefined;
  })();

  return { amountCop, dateIso, paymentMethod };
}

function deterministicMenuIntent(input: {
  text: string;
  conversation?: ConversationState;
}): NluResult | undefined {
  const { text, conversation } = input;
  const t = text.trim().toLowerCase();

  // Refusal to pay (strong signal, should not be treated as generic DENY)
  if (
    /(no\s+(?:quiero|voy\s+a|pienso)\s+pagar|me\s+niego\s+a\s+pagar|no\s+voy\s+a\s+pagar)/.test(t)
  ) {
    return { intent: 'REFUSE_PAY', entities: {}, confidence: 0.85, topicShift: false };
  }

  // Offer menu shortcuts (when the user is choosing an offer)
  if ((conversation?.state ?? '') === 'OFFER_MENU') {
    const m = t.match(/^\s*(\d{1,2})\s*$/);
    const offerIndex = m?.[1] ? Number(m[1]) : undefined;
    if (offerIndex && Number.isFinite(offerIndex) && offerIndex > 0) {
      return {
        intent: 'SELECT_OFFER',
        entities: { offerIndex },
        confidence: 0.95,
        topicShift: false,
      };
    }
  }

  // Short confirmations
  if (/^(s[ií]|ok|listo|dale|de acuerdo|confirmo)$/.test(t)) {
    return { intent: 'AFFIRM', entities: {}, confidence: 0.85, topicShift: false };
  }
  if (/^(no|nop|negativo)$/.test(t)) {
    return { intent: 'DENY', entities: {}, confidence: 0.85, topicShift: false };
  }

  // Greeting / start commands (Telegram etc.)
  if (
    t === '/start' ||
    /^(hola|buenas|buenos\s+d[ií]as|buen\s+d[ií]a|buenas\s+tardes|buenas\s+noches|hey|hi)\b/.test(t)
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
    return {
      intent: 'PROMISE_PAYMENT',
      entities: extractEntities(text),
      confidence: 0.75,
      topicShift: false,
    };
  }

  // Natural Spanish promise patterns (weekday / "esta semana"), even without ISO date
  if (
    /(pago|pagar)\s+el\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/.test(t)
  ) {
    return {
      intent: 'PROMISE_PAYMENT',
      entities: extractEntities(text),
      confidence: 0.78,
      topicShift: false,
    };
  }

  // Date-only or amount-only in negotiation context: treat as promise info
  if ((conversation?.state ?? '') === 'NEGOTIATION') {
    const ent = extractEntities(text);
    if (ent.dateIso || ent.amountCop) {
      return { intent: 'PROMISE_PAYMENT', entities: ent, confidence: 0.7, topicShift: false };
    }

    // If the user gives a time window like "esta semana", we still want to keep the promise flow.
    if (/\b(esta\s+semana|la\s+otra\s+semana|pr[oó]xima\s+semana)\b/.test(t)) {
      return { intent: 'PROMISE_PAYMENT', entities: ent, confidence: 0.65, topicShift: false };
    }
  }

  // Offtopic helpers
  if (/(qu(i|í)en\s+eres|qu(e|é)\s+eres|para\s+qu(e|é)\s+es|ayuda)/.test(t)) {
    return { intent: 'OFFTOPIC', entities: {}, confidence: 0.65, topicShift: true };
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
  if (
    /(no\s+(?:quiero|voy\s+a|pienso)\s+pagar|me\s+niego\s+a\s+pagar|no\s+voy\s+a\s+pagar)/.test(t)
  )
    return { intent: 'REFUSE_PAY', entities: {}, confidence: 0.7, topicShift: false };
  if (/(no debo|equivoc|fraude|estafa|no es mi)/.test(t))
    return { intent: 'DISPUTE', entities: {}, confidence: 0.6, topicShift: false };
  return { intent: 'UNKNOWN', entities: {}, confidence: 0.2, topicShift: false };
}

export async function parseIntent(input: {
  text: string;
  conversation?: ConversationState;
}): Promise<NluResult> {
  const deterministic = deterministicMenuIntent(input);
  if (deterministic) return deterministic;

  const prompt = NLU_PROMPT.replace('{{text}}', input.text).replace(
    '{{state}}',
    input.conversation?.state ?? 'UNKNOWN'
  );
  try {
    const raw = await llmJson(prompt, NLU_JSON_SCHEMA, 'nlu');
    const parsed = NluSchema.safeParse(raw);
    if (!parsed.success) return regexFallback(input.text);
    return parsed.data as NluResult;
  } catch {
    return regexFallback(input.text);
  }
}
