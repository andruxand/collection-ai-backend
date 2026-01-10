import { describe, expect, it } from 'vitest';

import type { ApiKeyRecord } from '../types';
import {
  generateClientApiKey,
  hashClientApiKeySecret,
  matchApiKey,
  parseClientApiKey,
} from './apiKey';

describe('apiKey', () => {
  it('generates and parses key', () => {
    const { apiKey } = generateClientApiKey();
    const parsed = parseClientApiKey(apiKey);
    expect(parsed).not.toBeNull();
    expect(parsed?.keyId).toBeTruthy();
    expect(parsed?.secret).toBeTruthy();
  });

  it('hashes and matches', () => {
    const pepper = 'pepper';
    const secret = 's3cr3t';
    const record: ApiKeyRecord = {
      keyId: 'kid',
      hash: hashClientApiKeySecret(secret, pepper),
      createdAtIso: new Date().toISOString(),
      status: 'ACTIVE',
      label: 'test',
    };
    expect(matchApiKey(record, secret, pepper)).toBe(true);
    expect(matchApiKey(record, 'wrong', pepper)).toBe(false);
  });
});
