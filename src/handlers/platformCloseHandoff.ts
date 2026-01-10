import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { putPlatformAudit } from '../core/store/platformAudit';
import { getHandoffCase, putHandoffEvent, updateHandoffCase } from '../core/store/repos';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const BodySchema = z.object({
  tenantId: z.string().min(3),
  caseSk: z.string().min(10),
  reason: z.string().max(400).optional(),
});

function ttlSeconds(days: number): number | undefined {
  if (!days || days <= 0) return undefined;
  return Math.floor(Date.now() / 1000) + days * 86400;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requirePlatformAuth(event);

    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid body', errors: parsed.error.flatten() }),
      };
    }

    assertTenantAccess(parsed.data.tenantId, ctx);

    await updateHandoffCase({
      tenantId: parsed.data.tenantId,
      caseSk: parsed.data.caseSk,
      patch: { status: 'CLOSED', closeReason: parsed.data.reason ?? null },
    });

    const item = await getHandoffCase({
      tenantId: parsed.data.tenantId,
      caseSk: parsed.data.caseSk,
    });
    if (!item) {
      return { statusCode: 404, body: JSON.stringify({ message: 'Handoff case not found' }) };
    }

    await putHandoffEvent({
      tenantId: parsed.data.tenantId,
      caseId: item.caseId,
      caseSk: parsed.data.caseSk,
      type: 'CLOSED',
      payload: { reason: parsed.data.reason },
      ttl: ttlSeconds(30),
    });

    await putPlatformAudit({
      tenantId: parsed.data.tenantId,
      actorSub: ctx.actorSub,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.role,
      action: 'HANDOFF_CLOSE',
      resource: `handoff:${parsed.data.caseSk}`,
      payload: { reason: parsed.data.reason },
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformCloseHandoff error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
