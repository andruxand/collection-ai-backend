import { DateTime } from 'luxon';

const MONTHS_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function normalizeText(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function parseNaturalDate(
  text: string,
  refIso?: string
): { dateIso: string | null; confidence: number } {
  const ref = refIso ? DateTime.fromISO(refIso) : DateTime.local();
  const t = normalizeText(String(text ?? '')).trim();
  if (!t) return { dateIso: null, confidence: 0 };

  // explicit keywords
  if (/\bhoy\b/.test(t)) return { dateIso: ref.toISODate(), confidence: 0.99 };
  if (/\bmanana\b/.test(t)) return { dateIso: ref.plus({ days: 1 }).toISODate(), confidence: 0.98 };
  if (/pasado\s+manana/.test(t))
    return { dateIso: ref.plus({ days: 2 }).toISODate(), confidence: 0.96 };

  // dd/mm or dd/mm/yyyy
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    const year = dm[3] ? Number(dm[3].length === 2 ? '20' + dm[3] : dm[3]) : ref.year;
    const dt = DateTime.fromObject({ year, month, day });
    if (dt.isValid) return { dateIso: dt.toISODate(), confidence: 0.95 };
  }

  // yyyy-mm-dd
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return { dateIso: iso[1], confidence: 0.99 };

  // 'el 25' or '25 de enero'
  const m1 = t.match(/\b(?:el\s*)?(\d{1,2})(?:\s+de\s+([a-z]+))?\b/);
  if (m1) {
    const day = Number(m1[1]);
    const monthName = m1[2];
    if (monthName && MONTHS_ES[monthName]) {
      const month = MONTHS_ES[monthName];
      let year = ref.year;
      let candidate = DateTime.fromObject({ year, month, day });
      if (!candidate.isValid) return { dateIso: null, confidence: 0 };
      if (candidate < ref.startOf('day')) year += 1;
      const dt = DateTime.fromObject({ year, month, day });
      return { dateIso: dt.toISODate(), confidence: 0.9 };
    }
    // day only: pick next occurrence of that day-of-month
    const dayOnly = dayFromString(m1[1]);
    if (dayOnly) {
      let month = ref.month;
      let year = ref.year;
      let dt = DateTime.fromObject({ year, month, day: dayOnly });
      if (!dt.isValid || dt < ref.startOf('day')) {
        dt = dt.plus({ months: 1 });
      }
      if (dt.isValid) return { dateIso: dt.toISODate(), confidence: 0.7 };
    }
  }

  // weekdays: 'proximo lunes' / 'lunes que viene'
  const wmatch = t.match(
    /\b(?:proximo|prximo|que viene)?\s*(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/
  );
  if (wmatch) {
    const w = wmatch[1];
    const weekdayMap: Record<string, number> = {
      lunes: 1,
      martes: 2,
      miercoles: 3,
      jueves: 4,
      viernes: 5,
      sabado: 6,
      domingo: 7,
    };
    const target = weekdayMap[w];
    if (target) {
      let dt = ref.startOf('day');
      const diff = (target + 7 - dt.weekday) % 7 || 7;
      dt = dt.plus({ days: diff });
      return { dateIso: dt.toISODate(), confidence: 0.8 };
    }
  }

  return { dateIso: null, confidence: 0 };
}

function dayFromString(s: string): number | null {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 31) return null;
  return n;
}
