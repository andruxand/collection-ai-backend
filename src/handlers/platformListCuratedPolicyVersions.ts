import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import { listPolicyVersions } from '../core/policy/curated/CuratedPolicyStore';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const ctx = requirePlatformAuth(event);

    const tenantId = String(event.queryStringParameters?.tenantId ?? '');
    const countryCode = String(event.queryStringParameters?.countryCode ?? '').toUpperCase();

    if (!tenantId) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, message: 'tenantId is required' }),
      };
    }

    if (!countryCode || countryCode.length !== 2) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, message: 'countryCode is required (2-letter)' }),
      };
    }

    assertTenantAccess(tenantId, ctx);

    const versions = listPolicyVersions(countryCode);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, tenantId, countryCode, versions }),
    };
  } catch (err: unknown) {
    const anyErr = err as { statusCode?: number; message?: string };
    const statusCode = typeof anyErr?.statusCode === 'number' ? anyErr.statusCode : 500;
    const message = typeof anyErr?.message === 'string' ? anyErr.message : 'Internal error';
    return {
      statusCode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, message }),
    };
  }
};
