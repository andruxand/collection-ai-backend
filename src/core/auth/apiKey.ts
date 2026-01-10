import crypto from 'crypto';

import type { ApiKeyRecord } from '../types';

export function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Format: ck_<keyId>_<secret>
export function generateClientApiKey(): { apiKey: string; keyId: string; secret: string } {
  const keyId = base64Url(crypto.randomBytes(8)); // short public id
  const secret = base64Url(crypto.randomBytes(32)); // long secret
  const apiKey = `ck.${keyId}.${secret}`;
  return { apiKey, keyId, secret };
}

export function parseClientApiKey(apiKey: string): { keyId: string; secret: string } | null {
  if (!apiKey) return null;
  if (!apiKey.startsWith('ck.')) return null;
  const rest = apiKey.slice(3);
  const idx = rest.indexOf('.');
  if (idx <= 0) return null;
  const keyId = rest.slice(0, idx);
  const secret = rest.slice(idx + 1);
  if (!keyId || !secret) return null;
  return { keyId, secret };
}

export function hashClientApiKeySecret(secret: string, pepper: string): string {
  // Pepper is a server-only secret stored in Secrets Manager or env
  return sha256Hex(`${pepper}:${secret}`);
}

export function matchApiKey(
  record: ApiKeyRecord,
  presentedSecret: string,
  pepper: string
): boolean {
  const h = hashClientApiKeySecret(presentedSecret, pepper);
  return timingSafeEqualHex(record.hash, h);
}
