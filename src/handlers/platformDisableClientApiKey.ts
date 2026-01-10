import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { putPlatformAudit } from '../core/store/platformAudit';
import { disableClientApiKey } from '../core/store/repos';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const BodySchema = z.object({ tenantId: z.string().min(3), keyId: z.string().min(6) });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requirePlatformAuth(event);
    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success)
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid body', errors: parsed.error.flatten() }),
      };
    assertTenantAccess(parsed.data.tenantId, ctx);

    await disableClientApiKey({ tenantId: parsed.data.tenantId, keyId: parsed.data.keyId });

    await putPlatformAudit({
      tenantId: parsed.data.tenantId,
      actorSub: ctx.actorSub,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.role,
      action: 'CLIENT_APIKEY_DISABLE',
      resource: `apikey:${parsed.data.keyId}`,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformDisableClientApiKey error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
