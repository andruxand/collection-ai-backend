import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { exportAuditForDate } from '../core/export/auditExport';
import { getTenant } from '../core/store/repos';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const BodySchema = z.object({
  tenantId: z.string().min(3),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

    const tenant = await getTenant(parsed.data.tenantId);
    if (!tenant.policy.exportPolicy.enabled || !tenant.policy.exportPolicy.s3Bucket) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Export not enabled for tenant' }),
      };
    }

    const res = await exportAuditForDate({ tenant, date: parsed.data.date });

    return { statusCode: 200, body: JSON.stringify({ ok: true, ...res }) };
  } catch (err: unknown) {
    logger.error('adminExportAudit error', { err });
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};
