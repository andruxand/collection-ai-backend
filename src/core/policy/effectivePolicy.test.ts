import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_POLICY } from '../tenant/defaults';
import type { CountryPolicy, TenantPolicy } from '../types';
import { buildEffectivePolicy } from './effectivePolicy';

function coBaseline(): CountryPolicy {
  return {
    countryCode: 'CO',
    version: 'v1',
    updatedAtIso: '2026-01-04T00:00:00.000Z',
    contactPolicy: {
      timezone: 'America/Bogota',
      channelsAllowed: { whatsapp: true, telegram: false, voice: false },
      maxContactsPerDay: 1,
      noMultichannelSameWeekAfterDirectContact: true,
      hours: {
        monFri: { from: '09:00', to: '17:00' },
        sat: { from: '10:00', to: '12:00' },
        sunBlocked: true,
        holidaysBlocked: true,
      },
    },
    contactLimitsByStage: {
      EARLY: { maxOutboundPerDay: 1, maxOutboundPerWeek: 2 },
      MID: { maxOutboundPerDay: 1, maxOutboundPerWeek: 3 },
      LATE: { maxOutboundPerDay: 1, maxOutboundPerWeek: 4 },
    },
    cooldowns: {
      noResponseDays: 3,
      brokenPromiseDays: 7,
    },
  };
}

describe('buildEffectivePolicy', () => {
  it('intersects hours and caps, and intersects allowed channels', () => {
    const tenantPolicy: TenantPolicy = {
      ...DEFAULT_TENANT_POLICY,
      contactPolicy: {
        ...DEFAULT_TENANT_POLICY.contactPolicy,
        // tenant tries to allow telegram and wider hours - effective must still respect country
        channelsAllowed: { whatsapp: true, telegram: true },
        maxContactsPerDay: 5,
        hours: {
          monFri: { from: '08:00', to: '18:00' },
          sat: { from: '09:00', to: '14:00' },
          sunBlocked: false,
          holidaysBlocked: false,
        },
      },
      cooldowns: { rejectedOfferDays: 1, noResponseDays: 1, brokenPromiseDays: 1 },
    };

    const eff = buildEffectivePolicy({ countryPolicy: coBaseline(), tenantPolicy });

    expect(eff.contactPolicy.maxContactsPerDay).toBe(1); // min
    expect(eff.contactPolicy.channelsAllowed?.telegram).toBe(false); // intersect
    expect(eff.contactPolicy.hours.monFri.from).toBe('09:00'); // intersection
    expect(eff.contactPolicy.hours.monFri.to).toBe('17:00');
    expect(eff.contactPolicy.hours.sunBlocked).toBe(true); // OR
    expect(eff.cooldowns.noResponseDays).toBe(3); // max
    expect(eff.cooldowns.brokenPromiseDays).toBe(7);
  });
});
