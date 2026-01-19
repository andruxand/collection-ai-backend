import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { listTenants } from '../core/store/repos';
import { requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const QuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requirePlatformAuth(event);
    if (!ctx.groups.includes('SUPER_ADMIN')) {
      return { statusCode: 403, body: JSON.stringify({ message: 'Forbidden' }) };
    }

    const parsed = QuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid query', errors: parsed.error.flatten() }),
      };
    }

    const items = await listTenants(parsed.data.limit ?? 50);
    return { statusCode: 200, body: JSON.stringify({ ok: true, items }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformListTenants error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
