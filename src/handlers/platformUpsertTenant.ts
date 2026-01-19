import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { putPlatformAudit } from '../core/store/platformAudit';
import { saveTenant } from '../core/store/repos';
import { mergeTenantPolicy } from '../core/tenant/defaults';
import type { Tenant, TenantPolicy } from '../core/types';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const ChannelsSchema = z
  .object({
    whatsapp: z
      .object({
        phoneNumberId: z.string().min(3),
        accessTokenSecretId: z.string().min(3),
      })
      .optional(),
    telegram: z
      .object({
        botTokenSecretId: z.string().min(3),
      })
      .optional(),
  })
  .default({});

const BodySchema = z.object({
  tenantId: z.string().min(3),
  name: z.string().min(2),
  channels: ChannelsSchema.optional(),
  policy: z.unknown().optional(),
});

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

    const policy: TenantPolicy = mergeTenantPolicy(parsed.data.policy);
    const tenant: Tenant = {
      tenantId: parsed.data.tenantId,
      name: parsed.data.name,
      channels: parsed.data.channels ?? {},
      policy,
    };

    await saveTenant(tenant);

    await putPlatformAudit({
      tenantId: tenant.tenantId,
      actorSub: ctx.actorSub,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.role,
      action: 'UPSERT_TENANT',
      resource: `TENANT#${tenant.tenantId}`,
      payload: { name: tenant.name, channels: tenant.channels },
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, tenantId: tenant.tenantId }) };
  } catch (err: unknown) {
    const e = toHttpError(err);
    logger.error('platformUpsertTenant error', { err: e });
    return {
      statusCode: e.statusCode,
      body: JSON.stringify({ message: e.message, details: e.details }),
    };
  }
};
