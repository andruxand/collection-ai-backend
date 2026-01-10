import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { getTenant } from '../core/store/repos';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const QuerySchema = z.object({ tenantId: z.string().min(3) });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requirePlatformAuth(event);
    const parsed = QuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid query', errors: parsed.error.flatten() }),
      };
    }
    assertTenantAccess(parsed.data.tenantId, ctx);
    const tenant = await getTenant(parsed.data.tenantId);
    return { statusCode: 200, body: JSON.stringify({ ok: true, tenant }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformGetTenant error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
