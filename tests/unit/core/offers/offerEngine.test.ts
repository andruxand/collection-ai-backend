import { describe, expect, it } from 'vitest';

import { buildOffers } from '@/core/offers/offerEngine';
import { DEFAULT_TENANT_POLICY } from '@/core/tenant/defaults';
import type { ConversationState, DebtorSnapshot, TenantPolicy } from '@/core/types';

describe('offerEngine.buildOffers', () => {
  it('applies ladder maxDiscountPct capped by hardCapDiscountPct', () => {
    const tenantPolicy: TenantPolicy = {
      ...DEFAULT_TENANT_POLICY,
      offerPolicy: {
        ladder: [
          { attempt: 1, maxDiscountPct: 0 },
          { attempt: 2, maxDiscountPct: 25 },
        ],
        maxAttempts: 6,
        hardCapDiscountPct: 10,
      },
    };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd',
      totalDueCop: 100000,
      daysPastDue: 40,
      stage: 'MID',
      consents: { whatsapp: true, telegram: false },
    };

    const conversation: ConversationState = {
      state: 'WELCOME',
      slots: {},
      attemptCount: 2,
      lastIntent: 'UNKNOWN',
    };

    const offers = buildOffers({ tenantPolicy, debtor, conversation });
    expect(offers.length).toBeGreaterThan(0);
    // attempt=2 -> maxDiscountPct=25 but hardCap=10 -> expect 10 applied
    expect(offers[0].discountPct).toBe(10);
  });
});
