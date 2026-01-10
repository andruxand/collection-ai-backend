import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import {
  disablePlatformUser,
  enablePlatformUser,
  updatePlatformUser,
} from '../core/platform/userAdmin';
import { putPlatformAudit } from '../core/store/platformAudit';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const BodySchema = z.object({
  tenantId: z.string().min(3),
  email: z.string().email(),
  enabled: z.boolean().optional(),
  role: z.enum(['TENANT_ADMIN', 'OPERATOR', 'SUPER_ADMIN', 'CLIENT_ADMIN']).optional(),
  tenantIds: z.array(z.string().min(3)).optional(),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requirePlatformAuth(event);
    const userPoolId = process.env.PLATFORM_USER_POOL_ID!;
    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success)
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid body', errors: parsed.error.flatten() }),
      };

    assertTenantAccess(parsed.data.tenantId, ctx);

    // Only SUPER_ADMIN can grant multi-tenant or SUPER_ADMIN role
    if (
      (parsed.data.tenantIds && !ctx.groups.includes('SUPER_ADMIN')) ||
      (parsed.data.role === 'SUPER_ADMIN' && !ctx.groups.includes('SUPER_ADMIN'))
    ) {
      return { statusCode: 403, body: JSON.stringify({ message: 'Forbidden' }) };
    }

    if (parsed.data.enabled === false)
      await disablePlatformUser({ userPoolId, email: parsed.data.email });
    if (parsed.data.enabled === true)
      await enablePlatformUser({ userPoolId, email: parsed.data.email });

    if (parsed.data.role || parsed.data.tenantIds) {
      await updatePlatformUser({
        userPoolId,
        email: parsed.data.email,
        role: parsed.data.role,
        tenantIdsCsv: parsed.data.tenantIds ? parsed.data.tenantIds.join(',') : undefined,
      });
    }

    await putPlatformAudit({
      tenantId: parsed.data.tenantId,
      actorSub: ctx.actorSub,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.role,
      action: 'PLATFORM_USER_UPDATE',
      resource: `user:${parsed.data.email}`,
      payload: {
        enabled: parsed.data.enabled,
        role: parsed.data.role,
        tenantIds: parsed.data.tenantIds,
      },
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformSetUserStatus error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
