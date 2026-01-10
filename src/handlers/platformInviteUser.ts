import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { invitePlatformUser } from '../core/platform/userAdmin';
import { putPlatformAudit } from '../core/store/platformAudit';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const BodySchema = z.object({
  tenantId: z.string().min(3),
  email: z.string().email(),
  role: z.enum(['TENANT_ADMIN', 'OPERATOR', 'SUPER_ADMIN', 'CLIENT_ADMIN']).default('OPERATOR'),
  // optional: if SUPER_ADMIN wants to grant multiple tenants at once
  tenantIds: z.array(z.string().min(3)).optional(),
  groupsAdd: z.array(z.string().min(1)).optional(),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requirePlatformAuth(event);
    const userPoolId = process.env.PLATFORM_USER_POOL_ID!;
    if (!userPoolId)
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Missing PLATFORM_USER_POOL_ID' }),
      };

    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success)
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid body', errors: parsed.error.flatten() }),
      };

    // Tenant admins can only invite users for the tenant they can access
    assertTenantAccess(parsed.data.tenantId, ctx);

    const tenantIds = ctx.groups.includes('SUPER_ADMIN')
      ? parsed.data.tenantIds ?? [parsed.data.tenantId]
      : [parsed.data.tenantId];

    const tenantIdsCsv = tenantIds.join(',');
    const groups = parsed.data.groupsAdd ?? [];
    if (parsed.data.role === 'SUPER_ADMIN' && !ctx.groups.includes('SUPER_ADMIN')) {
      return { statusCode: 403, body: JSON.stringify({ message: 'Forbidden' }) };
    }

    await invitePlatformUser({
      userPoolId,
      email: parsed.data.email,
      tenantIdsCsv,
      role: parsed.data.role,
      groups,
    });

    await putPlatformAudit({
      tenantId: parsed.data.tenantId,
      actorSub: ctx.actorSub,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.role,
      action: 'PLATFORM_USER_INVITE',
      resource: `user:${parsed.data.email}`,
      payload: { tenantIds, role: parsed.data.role, groups },
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformInviteUser error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
