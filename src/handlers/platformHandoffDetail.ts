import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { getHandoffCase, listHandoffEvents } from '../core/store/repos';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const QuerySchema = z.object({
  tenantId: z.string().min(3),
  caseSk: z.string().min(10),
  eventsLimit: z.coerce.number().int().min(1).max(300).optional(),
});

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

    const item = await getHandoffCase({
      tenantId: parsed.data.tenantId,
      caseSk: parsed.data.caseSk,
    });
    if (!item) return { statusCode: 404, body: JSON.stringify({ message: 'Not found' }) };

    const events = await listHandoffEvents({
      tenantId: parsed.data.tenantId,
      caseId: item.caseId,
      limit: parsed.data.eventsLimit,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, case: item, events }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformHandoffDetail error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
