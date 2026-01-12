import type { CountryPolicy, TenantPolicy, TenantStage } from '../types';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}
function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function intersectRange(a: { from: string; to: string }, b: { from: string; to: string }) {
  const from = Math.max(toMinutes(a.from), toMinutes(b.from));
  const to = Math.min(toMinutes(a.to), toMinutes(b.to));
  return { from: toHHMM(from), to: toHHMM(to) };
}

/**
 * Enforces: Tenant can be **more strict**, never more permissive than the country baseline.
 */
export function buildEffectivePolicy(input: {
  countryPolicy: CountryPolicy;
  tenantPolicy: TenantPolicy;
}): TenantPolicy {
  const { countryPolicy, tenantPolicy } = input;

  // Legal baseline: channelsAllowed should be defined at country level, but we
  // tolerate missing data (old policies) by treating it as "no extra restriction".
  const countryChannels = countryPolicy.contactPolicy.channelsAllowed || {
    whatsapp: false,
    telegram: false,
  };
  const tenantChannels = tenantPolicy.contactPolicy.channelsAllowed || {
    whatsapp: false,
    telegram: false,
  };
  const effectiveChannelsAllowed = {
    // Tenant can only further restrict; if tenant omite channelsAllowed, se asume "no restricción extra" (true).
    whatsapp: Boolean(countryChannels.whatsapp) && Boolean(tenantChannels.whatsapp),
    telegram: Boolean(countryChannels.telegram) && Boolean(tenantChannels.telegram),
  };

  // hours intersection (if tenant is stricter, intersection shrinks window)
  const monFri = intersectRange(
    countryPolicy.contactPolicy.hours.monFri,
    tenantPolicy.contactPolicy.hours.monFri
  );
  const sat = intersectRange(
    countryPolicy.contactPolicy.hours.sat,
    tenantPolicy.contactPolicy.hours.sat
  );

  const effective: TenantPolicy = {
    ...tenantPolicy,

    contactPolicy: {
      ...tenantPolicy.contactPolicy,
      // take countryCode explicitly from baseline, allow tenant to override only if it's same (keep simple for MVP)
      countryCode: countryPolicy.countryCode,
      timezone: tenantPolicy.contactPolicy.timezone || countryPolicy.contactPolicy.timezone,
      channelsAllowed: effectiveChannelsAllowed,

      // caps: choose min (stricter)
      maxContactsPerDay: Math.min(
        countryPolicy.contactPolicy.maxContactsPerDay,
        tenantPolicy.contactPolicy.maxContactsPerDay
      ),

      // booleans: choose OR (stricter)
      noMultichannelSameWeekAfterDirectContact:
        Boolean(countryPolicy.contactPolicy.noMultichannelSameWeekAfterDirectContact) ||
        Boolean(tenantPolicy.contactPolicy.noMultichannelSameWeekAfterDirectContact),

      hours: {
        monFri,
        sat,
        sunBlocked:
          Boolean(countryPolicy.contactPolicy.hours.sunBlocked) ||
          Boolean(tenantPolicy.contactPolicy.hours.sunBlocked),
        holidaysBlocked:
          Boolean(countryPolicy.contactPolicy.hours.holidaysBlocked) ||
          Boolean(tenantPolicy.contactPolicy.hours.holidaysBlocked),
      },
    },

    contactLimitsByStage: (Object.keys(tenantPolicy.contactLimitsByStage) as TenantStage[]).reduce(
      (acc, stage) => {
        const c = countryPolicy.contactLimitsByStage[stage];
        const t = tenantPolicy.contactLimitsByStage[stage];
        acc[stage] = {
          maxOutboundPerDay: Math.min(c.maxOutboundPerDay, t.maxOutboundPerDay),
          maxOutboundPerWeek: Math.min(c.maxOutboundPerWeek, t.maxOutboundPerWeek),
        };
        return acc;
      },
      {} as TenantPolicy['contactLimitsByStage']
    ),

    cooldowns: {
      rejectedOfferDays: tenantPolicy.cooldowns.rejectedOfferDays,
      noResponseDays: Math.max(
        countryPolicy.cooldowns.noResponseDays,
        tenantPolicy.cooldowns.noResponseDays
      ),
      brokenPromiseDays: Math.max(
        countryPolicy.cooldowns.brokenPromiseDays,
        tenantPolicy.cooldowns.brokenPromiseDays
      ),
    },
  };

  return effective;
}

/**
 * Validate tenant policy does not attempt to enable channels disallowed by the country.
 * (In MVP we use intersection anyway; this is mainly for warnings/errors in admin UX.)
 */
export function validateTenantAgainstCountry(input: {
  countryPolicy: CountryPolicy;
  tenantPolicy: TenantPolicy;
}): { ok: true } | { ok: false; errors: string[] } {
  const { countryPolicy, tenantPolicy } = input;
  const errors: string[] = [];

  const tenantAllowed = tenantPolicy.contactPolicy.channelsAllowed;
  const countryAllowed = countryPolicy.contactPolicy.channelsAllowed || {
    whatsapp: true,
    telegram: true,
  };
  if (tenantAllowed) {
    if (tenantAllowed.whatsapp && !countryAllowed.whatsapp) {
      errors.push('Tenant enables WhatsApp but country policy disallows it.');
    }
    if (tenantAllowed.telegram && !countryAllowed.telegram) {
      errors.push('Tenant enables Telegram but country policy disallows it.');
    }
  }

  // tenant must not exceed caps (more permissive) — for caps we can check if tenant > country (meaning more contacts)
  if (
    tenantPolicy.contactPolicy.maxContactsPerDay > countryPolicy.contactPolicy.maxContactsPerDay
  ) {
    errors.push('Tenant maxContactsPerDay is more permissive than country baseline.');
  }

  for (const stage of Object.keys(tenantPolicy.contactLimitsByStage) as TenantStage[]) {
    const t = tenantPolicy.contactLimitsByStage[stage];
    const c = countryPolicy.contactLimitsByStage[stage];
    if (t.maxOutboundPerDay > c.maxOutboundPerDay)
      errors.push(
        `Tenant maxOutboundPerDay for ${stage} is more permissive than country baseline.`
      );
    if (t.maxOutboundPerWeek > c.maxOutboundPerWeek)
      errors.push(
        `Tenant maxOutboundPerWeek for ${stage} is more permissive than country baseline.`
      );
  }

  // cooldowns: tenant must not be smaller than country (more permissive)
  if (tenantPolicy.cooldowns.noResponseDays < countryPolicy.cooldowns.noResponseDays) {
    errors.push('Tenant noResponseDays is more permissive than country baseline.');
  }
  if (tenantPolicy.cooldowns.brokenPromiseDays < countryPolicy.cooldowns.brokenPromiseDays) {
    errors.push('Tenant brokenPromiseDays is more permissive than country baseline.');
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
