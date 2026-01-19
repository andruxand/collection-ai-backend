const METHOD_VALUES = ['PSE', 'CARD', 'TRANSFER', 'CASH'] as const;

export function validateAmountCop(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  return undefined;
}

export function validateDateIso(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(v);
  return m ? v : undefined;
}

export function validatePaymentMethod(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.toUpperCase() : '';
  return (METHOD_VALUES as readonly string[]).includes(s) ? s : undefined;
}
