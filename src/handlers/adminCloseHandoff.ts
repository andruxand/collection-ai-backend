import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { closeHandoffCase } from '../core/store/repos';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const BodySchema = z.object({
  tenantId: z.string().min(3),
  caseSk: z.string().min(10),
  reason: z.string().max(400).optional(),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const apiKey = event.headers?.['x-api-key'] ?? event.headers?.['X-Api-Key'];
    if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
      return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid body', errors: parsed.error.flatten() }),
      };
    }

    await closeHandoffCase({
      tenantId: parsed.data.tenantId,
      caseSk: parsed.data.caseSk,
      reason: parsed.data.reason,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err: unknown) {
    logger.error('adminCloseHandoff error', { err });
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};
