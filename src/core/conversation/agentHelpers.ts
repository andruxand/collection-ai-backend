import { parseNaturalDate } from './nlDateParser';

export function textSuggestsWrongPerson(userTextRaw: string): boolean {
  const t = String(userTextRaw ?? '').toLowerCase();
  return /(no\s+soy|no\s+es\s+para\s+mi|numero\s+equivocado|n[úu]mero\s+equivocado|se\s+equivocaron|equivocad[oa]|no\s+me\s+contacte(n)?|no\s+me\s+escriba(n)?|no\s+conozco\s+a|no\s+corresponde)/i.test(
    t
  );
}

export function sanitizeEntities(params: {
  userTextRaw: string;
  entities: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const userText = String(params.userTextRaw ?? '');
  const t = userText.toLowerCase();
  const entities = { ...(params.entities ?? {}) };

  // If the user didn't mention numbers, avoid carrying an amount.
  const hasDigits = /\d/.test(userText);
  if (!hasDigits) entities['amountCop'] = null;

  // If there's no explicit date pattern, try natural-language parse.
  const hasDateLike =
    /\b\d{4}-\d{2}-\d{2}\b/.test(userText) || /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(userText);
  if (!hasDateLike) {
    const parsed = parseNaturalDate(userText);
    if (parsed.dateIso) {
      entities['dateIso'] = parsed.dateIso;
    } else {
      entities['dateIso'] = null;
    }
  }

  // Payment methods: only keep if explicitly mentioned.
  const mentionsMethod = /(pse|tarjeta|transferenc|banco|efectivo|cash)/i.test(t);
  if (!mentionsMethod) entities['paymentMethod'] = null;

  return entities;
}

export function textSuggestsPayNow(userTextRaw: string): boolean {
  const t = String(userTextRaw ?? '').toLowerCase();
  return /\b(pagar\s+hoy|pago\s+hoy|pagar\s+ahora|pago\s+ahora|quiero\s+pagar\s+hoy|quiero\s+pagar\s+ahora|hoy\s+quiero\s+pagar|pagar\s+de\s+una|pago\s+de\s+una)\b/.test(t);
}

export function preferReengageFromClassifier(classifier: Record<string, unknown>): string | null {
  const intent = String(classifier['intent'] ?? '').toUpperCase();
  const flags = (classifier['flags'] as Record<string, unknown>) ?? {};
  if (flags['lowContext'] === true && (intent === 'OFF_TOPIC' || intent === 'UNKNOWN'))
    return 'negotiation.reengage';
  return null;
}
