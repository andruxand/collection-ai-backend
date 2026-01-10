import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { listOpenHandoffCases } from '../core/store/repos';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const QuerySchema = z.object({
  tenantId: z.string().min(3),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const apiKey = event.headers?.['x-api-key'] ?? event.headers?.['X-Api-Key'];
    if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    const parsed = QuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid query', errors: parsed.error.flatten() }),
      };
    }

    const items = await listOpenHandoffCases({
      tenantId: parsed.data.tenantId,
      limit: parsed.data.limit,
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, items }) };
  } catch (err: unknown) {
    logger.error('adminListHandoffs error', { err });
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};
