function maskDigitsKeepingLast(s: string, keepLast = 2): string {
  const digits = s.replace(/\D/g, '');
  if (digits.length <= keepLast) return '[redacted]';
  const tail = digits.slice(-keepLast);
  return `[redacted-**${tail}]`;
}

export function maskPii(text: string): string {
  let out = text;

  // Emails
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');

  // ID documents (prefer labeling as [id])
  out = out.replace(/\b(cc|c\s*\.?c\.?|cedula|cédula|nit)\s*[:#-]?\s*\d{7,12}\b/gi, (_m, p1) => {
    const prefix = typeof p1 === 'string' ? p1 : 'id';
    return `${prefix} [id]`;
  });

  // Phone-ish sequences (keep last digits for debugging)
  out = out.replace(/\+?\d[\d\s()-]{6,}\d/g, (m) => maskDigitsKeepingLast(m, 2));

  // ID docs / long digit sequences
  out = out.replace(/\b\d{7,12}\b/g, '[id]');

  return out;
}

export function redactTurns<T extends { text?: string }>(turns: T[]): T[] {
  return turns.map((t) => ({ ...t, text: typeof t.text === 'string' ? maskPii(t.text) : t.text }));
}
