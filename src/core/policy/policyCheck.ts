import Holidays from 'date-holidays';
import { DateTime } from 'luxon';

import type { ContactState, DebtorSnapshot, TenantPolicy } from '../types';

const holidaysCache = new Map<string, Holidays>();

function getHolidays(countryCode: string | undefined): Holidays | undefined {
  const code = (countryCode || 'CO').toUpperCase();
  if (holidaysCache.has(code)) return holidaysCache.get(code);
  try {
    const hd = new Holidays(code);
    holidaysCache.set(code, hd);
    return hd;
  } catch {
    return undefined;
  }
}

export function policyCheck(input: {
  now: Date;
  tenantPolicy: TenantPolicy;
  debtor: DebtorSnapshot;
  contact: ContactState;
  channel: 'whatsapp' | 'telegram';
  direction: 'reply' | 'outbound'; // reply=user initiated
}) {
  const { now, tenantPolicy, debtor, contact, channel, direction } = input;

  if (contact.optedOut) return { allowed: false, reason: 'OPTED_OUT' as const };

  // Channel gate (country/tenant effective policy): block outbound if channel is disallowed.
  if (direction === 'outbound' && tenantPolicy.contactPolicy.channelsAllowed) {
    const allowed =
      channel === 'whatsapp'
        ? tenantPolicy.contactPolicy.channelsAllowed.whatsapp
        : tenantPolicy.contactPolicy.channelsAllowed.telegram;
    if (!allowed) return { allowed: false, reason: 'CHANNEL_BLOCKED' as const };
  }

  // Consent gate: required for outbound. For replies (user-initiated) we allow processing even if consent is not stored yet.
  const consentOk = channel === 'whatsapp' ? debtor.consents.whatsapp : debtor.consents.telegram;
  if (direction === 'outbound' && !consentOk)
    return { allowed: false, reason: 'NO_CONSENT' as const };

  // Outbound cooldown gate
  if (direction === 'outbound' && contact.nextContactAllowedAt) {
    const next = Date.parse(contact.nextContactAllowedAt);
    if (!Number.isNaN(next) && now.getTime() < next) {
      return {
        allowed: false,
        reason: 'COOLDOWN' as const,
        nextContactAllowedAt: contact.nextContactAllowedAt,
      };
    }
  }

  // Rule: don't switch channels within 7 days after user contacted us (direct contact)
  if (
    direction === 'outbound' &&
    tenantPolicy.contactPolicy.noMultichannelSameWeekAfterDirectContact
  ) {
    const last = contact.lastDirectContactAt ? Date.parse(contact.lastDirectContactAt) : Number.NaN;
    if (
      !Number.isNaN(last) &&
      contact.lastDirectContactChannel &&
      contact.lastDirectContactChannel !== channel
    ) {
      const diffDays = (now.getTime() - last) / (24 * 60 * 60 * 1000);
      if (diffDays < 7) return { allowed: false, reason: 'NO_MULTICHANNEL_WEEK' as const };
    }
  }

  // For "reply", we generally allow even outside hours (user initiated). For "outbound", enforce.
  if (direction === 'outbound') {
    const zone = tenantPolicy.contactPolicy.timezone || 'America/Bogota';
    const dt = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(zone);

    const dayKey = dt.toISODate() as string; // YYYY-MM-DD
    const weekKey = `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;

    const dCount = contact.outboundDaily?.[dayKey] ?? 0;
    const wCount = contact.outboundWeekly?.[weekKey] ?? 0;

    // Global cap (legacy)
    const globalCap = tenantPolicy.contactPolicy.maxContactsPerDay;
    if (typeof globalCap === 'number' && dCount >= globalCap) {
      return { allowed: false, reason: 'LIMIT_DAILY_GLOBAL' as const };
    }

    // Stage limits (preferred)
    const limits = tenantPolicy.contactLimitsByStage?.[debtor.stage];
    if (limits) {
      if (dCount >= limits.maxOutboundPerDay)
        return { allowed: false, reason: 'LIMIT_DAILY' as const };
      if (wCount >= limits.maxOutboundPerWeek)
        return { allowed: false, reason: 'LIMIT_WEEKLY' as const };
    }

    if (tenantPolicy.contactPolicy.hours.holidaysBlocked) {
      const hd = getHolidays(tenantPolicy.contactPolicy.countryCode);
      const holiday = hd?.isHoliday(dt.toJSDate());
      if (holiday) return { allowed: false, reason: 'HOLIDAY_BLOCKED' as const };
    }

    if (dt.weekday === 7 && tenantPolicy.contactPolicy.hours.sunBlocked) {
      return { allowed: false, reason: 'SUNDAY_BLOCKED' as const };
    }

    const inRange = (from: string, to: string) => {
      const [fh, fm] = from.split(':').map(Number);
      const [th, tm] = to.split(':').map(Number);
      const minutes = dt.hour * 60 + dt.minute;
      const a = fh * 60 + fm;
      const b = th * 60 + tm;
      return minutes >= a && minutes <= b;
    };

    if (dt.weekday >= 1 && dt.weekday <= 5) {
      if (
        !inRange(
          tenantPolicy.contactPolicy.hours.monFri.from,
          tenantPolicy.contactPolicy.hours.monFri.to
        )
      ) {
        return { allowed: false, reason: 'OUT_OF_HOURS' as const };
      }
    } else if (dt.weekday === 6) {
      if (
        !inRange(tenantPolicy.contactPolicy.hours.sat.from, tenantPolicy.contactPolicy.hours.sat.to)
      ) {
        return { allowed: false, reason: 'OUT_OF_HOURS' as const };
      }
    }
  }

  return { allowed: true as const };
}
