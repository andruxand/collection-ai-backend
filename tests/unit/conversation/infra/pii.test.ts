import { describe, expect, test } from 'vitest';

import { maskPii } from '@/conversation/infra/pii';

describe('maskPii', () => {
  test('masks email', () => {
    expect(maskPii('mi correo es test@example.com')).toContain('[email]');
  });

  test('masks phone-ish digits', () => {
    const out = maskPii('mi numero es +57 300 123 4567');
    expect(out).toContain('[redacted');
  });

  test('masks id-like digits', () => {
    expect(maskPii('cc 1234567890')).toContain('[id]');
  });
});
