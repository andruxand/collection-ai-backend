import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_POLICY } from '../tenant/defaults';
import type { ContactState, DebtorSnapshot, TenantPolicy } from '../types';
import { policyCheck } from './policyCheck';

function baseTenantPolicy(overrides?: Partial<TenantPolicy>): TenantPolicy {
  return {
    ...DEFAULT_TENANT_POLICY,
    ...overrides,
    contactPolicy: { ...DEFAULT_TENANT_POLICY.contactPolicy, ...(overrides?.contactPolicy ?? {}) },
  };
}

function baseDebtor(overrides?: Partial<DebtorSnapshot>): DebtorSnapshot {
  return {
    tenantId: 'tenant-demo',
    debtorId: 'd1',
    stage: 'EARLY',
    totalDueCop: 500000,
    daysPastDue: 10,
    dueDate: '2026-01-01',
    consents: { whatsapp: true, telegram: true },
    ...overrides,
  };
}

function baseContact(overrides?: Partial<ContactState>): ContactState {
  return {
    tenantId: 'tenant-demo',
    debtorId: 'd1',
    optedOut: false,
    outboundDaily: {},
    outboundWeekly: {},
    ...overrides,
  };
}

describe('policyCheck', () => {
  it('blocks outbound when channel is disallowed by effective policy', () => {
    const tenantPolicy: TenantPolicy = baseTenantPolicy({
      contactPolicy: {
        ...DEFAULT_TENANT_POLICY.contactPolicy,
        channelsAllowed: { whatsapp: false, telegram: true },
      },
    });

    const debtor: DebtorSnapshot = baseDebtor({ consents: { whatsapp: true, telegram: true } });
    const contact: ContactState = baseContact();
    const now = new Date('2026-01-02T15:00:00.000Z'); // within hours

    const res = policyCheck({
      now,
      tenantPolicy,
      debtor,
      contact,
      channel: 'whatsapp',
      direction: 'outbound',
    });

    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('CHANNEL_BLOCKED');
  });

  it('blocks opted out', () => {
    const res = policyCheck({
      now: new Date(),
      tenantPolicy: baseTenantPolicy(),
      debtor: baseDebtor(),
      contact: baseContact({ optedOut: true }),
      channel: 'whatsapp',
      direction: 'outbound',
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('OPTED_OUT');
  });

  it('blocks outbound when cooldown active', () => {
    const res = policyCheck({
      now: new Date('2026-01-02T15:00:00Z'),
      tenantPolicy: baseTenantPolicy(),
      debtor: baseDebtor(),
      contact: baseContact({ nextContactAllowedAt: '2026-01-05T00:00:00.000Z' }),
      channel: 'whatsapp',
      direction: 'outbound',
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('COOLDOWN');
  });

  it('allows reply even without stored consent', () => {
    const res = policyCheck({
      now: new Date('2026-01-02T03:00:00Z'), // outside hours, but reply
      tenantPolicy: baseTenantPolicy(),
      debtor: baseDebtor({ consents: { whatsapp: false, telegram: false } }),
      contact: baseContact(),
      channel: 'whatsapp',
      direction: 'reply',
    });
    expect(res.allowed).toBe(true);
  });

  it('blocks outbound outside hours', () => {
    const res = policyCheck({
      now: new Date('2026-01-02T03:00:00Z'), // 22:00 Bogota prev day
      tenantPolicy: baseTenantPolicy({
        contactPolicy: {
          ...DEFAULT_TENANT_POLICY.contactPolicy,
          hours: { ...DEFAULT_TENANT_POLICY.contactPolicy.hours, holidaysBlocked: false },
        },
      }),
      debtor: baseDebtor(),
      contact: baseContact(),
      channel: 'whatsapp',
      direction: 'outbound',
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('OUT_OF_HOURS');
  });

  it('blocks outbound on holidays when configured', () => {
    const tenantPolicy = baseTenantPolicy({
      contactPolicy: {
        ...DEFAULT_TENANT_POLICY.contactPolicy,
        hours: { ...DEFAULT_TENANT_POLICY.contactPolicy.hours, holidaysBlocked: true },
        countryCode: 'CO',
      },
    });

    // Jan 1 is a holiday in Colombia
    const res = policyCheck({
      now: new Date('2026-01-01T15:00:00Z'), // 10:00 Bogota
      tenantPolicy,
      debtor: baseDebtor(),
      contact: baseContact(),
      channel: 'whatsapp',
      direction: 'outbound',
    });

    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('HOLIDAY_BLOCKED');
  });

  it('blocks by global daily cap', () => {
    const tenantPolicy = baseTenantPolicy({
      contactPolicy: { ...DEFAULT_TENANT_POLICY.contactPolicy, maxContactsPerDay: 1 },
    });

    const res = policyCheck({
      now: new Date('2026-01-02T15:00:00Z'),
      tenantPolicy,
      debtor: baseDebtor(),
      contact: baseContact({ outboundDaily: { '2026-01-02': 1 } }),
      channel: 'whatsapp',
      direction: 'outbound',
    });

    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('LIMIT_DAILY_GLOBAL');
  });

  it('blocks by stage weekly cap', () => {
    const tenantPolicy = baseTenantPolicy({
      contactLimitsByStage: {
        EARLY: { maxOutboundPerDay: 10, maxOutboundPerWeek: 1 },
        MID: { maxOutboundPerDay: 10, maxOutboundPerWeek: 1 },
        LATE: { maxOutboundPerDay: 10, maxOutboundPerWeek: 1 },
      },
    });

    const res = policyCheck({
      now: new Date('2026-01-02T15:00:00Z'),
      tenantPolicy,
      debtor: baseDebtor({ stage: 'EARLY' }),
      contact: baseContact({ outboundWeekly: { '2026-W01': 1 } }),
      channel: 'whatsapp',
      direction: 'outbound',
    });

    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('LIMIT_WEEKLY');
  });
});
