import { beforeEach, describe, expect, it } from 'vitest';

import { clearCuratedPolicyCache } from '@/core/policy/curated/CuratedPolicyStore';
import { CuratedPolicyTool } from '@/core/policy/curated/CuratedPolicyTool';

describe('CuratedPolicyTool', () => {
  beforeEach(() => {
    clearCuratedPolicyCache();
  });

  it('resolves latest CO policy snapshot (no explicit version)', () => {
    const res = CuratedPolicyTool.resolvePolicySnapshot({ countryCode: 'CO' });

    expect(res.usedFallback).toBe(false);
    expect(res.snapshot.countryCode).toBe('CO');
    expect(res.snapshot.policyVersion).toBe('2026-01-18.v1');
    expect(res.snapshot.complianceNotes).toContain('NO_LEGAL_THREATS');
    expect(res.snapshot.sourceRefsMinimal.length).toBeGreaterThan(0);
    expect(res.missingSourceIds).toEqual([]);
  });

  it('falls back to baseline policy when country has no curated policy', () => {
    const res = CuratedPolicyTool.resolvePolicySnapshot({ countryCode: 'ZZ' });

    expect(res.usedFallback).toBe(true);
    expect(res.snapshot.countryCode).toBe('ZZ');
    expect(res.snapshot.policyVersion).toBe('baseline.safe.v1');
    expect(res.snapshot.missingFallbackUsed).toBe(true);
  });

  it('falls back to baseline policy when explicit version is missing', () => {
    const res = CuratedPolicyTool.resolvePolicySnapshot({
      countryCode: 'CO',
      policyVersion: '1900-01-01.v999',
    });

    expect(res.usedFallback).toBe(true);
    expect(res.snapshot.countryCode).toBe('CO');
    expect(res.snapshot.policyVersion).toBe('baseline.safe.v1');
  });
});
