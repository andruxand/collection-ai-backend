function normalizeText(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function parseFlexibleMoney(text: string): { amountCop: number | null; confidence: number } {
  const t = normalizeText(String(text ?? ''));
  if (!t) return { amountCop: null, confidence: 0 };

  // Slang: "X palos"
  const palos = t.match(/\b(\d+(?:[\.,]\d+)?)\s*palos\b/);
  if (palos) {
    const n = Number(palos[1].replace(',', '.'));
    if (Number.isFinite(n)) return { amountCop: Math.round(n * 1_000_000), confidence: 0.9 };
  }

  // "un millon" / "1 millon"
  if (/\bun\s*millon\b/.test(t)) return { amountCop: 1_000_000, confidence: 0.85 };
  const nMillon = t.match(/\b(\d+(?:[\.,]\d+)?)\s*millon(?:es)?\b/);
  if (nMillon) {
    const n = Number(nMillon[1].replace(',', '.'));
    if (Number.isFinite(n)) return { amountCop: Math.round(n * 1_000_000), confidence: 0.9 };
  }

  // "X mil" or "Xk"
  const mil = t.match(/\b(\d+(?:[\.,]\d+)?)\s*mil\b/);
  if (mil) {
    const n = Number(mil[1].replace(',', '.'));
    if (Number.isFinite(n)) return { amountCop: Math.round(n * 1_000), confidence: 0.9 };
  }
  const k = t.match(/\b(\d+(?:[\.,]\d+)?)\s*k\b/);
  if (k) {
    const n = Number(k[1].replace(',', '.'));
    if (Number.isFinite(n)) return { amountCop: Math.round(n * 1_000), confidence: 0.9 };
  }

  // "Xm" (millions)
  const m = t.match(/\b(\d+(?:[\.,]\d+)?)\s*m\b/);
  if (m) {
    const n = Number(m[1].replace(',', '.'));
    if (Number.isFinite(n)) return { amountCop: Math.round(n * 1_000_000), confidence: 0.9 };
  }

  // Plain numbers with thousand separators: "1.200.000" or "500.000" or "1200000"
  const plain = t.match(/\b(\d{1,3}(?:[\.,]\d{3})+|\d{4,})\b/);
  if (plain) {
    const cleaned = plain[1].replace(/[\.,]/g, '');
    const n = Number(cleaned);
    if (Number.isFinite(n)) return { amountCop: n, confidence: 0.95 };
  }

  // Fallback: "500" => 500 mil
  const low = t.match(/\b(\d{2,3})\b/);
  if (low) {
    const n = Number(low[1]);
    if (Number.isFinite(n)) return { amountCop: n * 1_000, confidence: 0.6 };
  }

  return { amountCop: null, confidence: 0 };
}
