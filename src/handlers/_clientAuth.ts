import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { matchApiKey, parseClientApiKey } from '../core/auth/apiKey';
import { getTenant, touchClientApiKey } from '../core/store/repos';

export async function requireClientAuth(
  event: APIGatewayProxyEventV2
): Promise<{ tenantId: string; keyId: string }> {
  const tenantId = event.headers?.['x-tenant-id'] ?? event.headers?.['X-Tenant-Id'];
  const apiKey = event.headers?.['x-api-key'] ?? event.headers?.['X-Api-Key'];
  if (!tenantId || !apiKey) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });

  const parsed = parseClientApiKey(apiKey);
  if (!parsed) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });

  const pepper = process.env.API_KEY_PEPPER;
  if (!pepper) throw Object.assign(new Error('Server misconfigured'), { statusCode: 500 });

  const tenant = await getTenant(tenantId);
  const keys = tenant.clientAuth?.apiKeys ?? [];
  const record = keys.find((k) => k.keyId === parsed.keyId && k.status === 'ACTIVE');
  if (!record) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });

  const ok = matchApiKey(record, parsed.secret, pepper);
  if (!ok) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });

  await touchClientApiKey({ tenantId, keyId: parsed.keyId });

  return { tenantId, keyId: parsed.keyId };
}
