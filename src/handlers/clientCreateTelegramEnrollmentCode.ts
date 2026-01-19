import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { createTelegramEnrollmentCode, getDebtor } from '../core/store/enrollmentCodes';
import { requireClientAuth } from './_clientAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const BodySchema = z.object({
  // tenantId derived from x-tenant-id for client API
  tenantId: z.never().optional(),
  debtorId: z.string().min(1),
  ttlHours: z.number().int().min(1).max(168).optional(),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = await requireClientAuth(event);

    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid body', errors: parsed.error.flatten() }),
      };
    }

    const debtor = await getDebtor(auth.tenantId, parsed.data.debtorId);
    if (!debtor) {
      return { statusCode: 404, body: JSON.stringify({ message: 'Debtor not found' }) };
    }

    const { code, expiresAtIso } = await createTelegramEnrollmentCode({
      tenantId: auth.tenantId,
      debtorId: parsed.data.debtorId,
      ttlHours: parsed.data.ttlHours ?? 24,
    });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, debtorId: parsed.data.debtorId, code, expiresAtIso }),
    };
  } catch (err: unknown) {
    logger.error('clientCreateTelegramEnrollmentCode error', { err });
    const statusCode = (err as { statusCode?: number } | undefined)?.statusCode ?? 500;
    return { statusCode, body: JSON.stringify({ message: 'Internal error' }) };
  }
};
