import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { getTenant, saveTenant } from '../core/store/repos';
import { mergeTenantPolicy } from '../core/tenant/defaults';
import type { TenantPolicy } from '../core/types';

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
  name: z.string().min(2).optional(),
  channels: ChannelsSchema.optional(),
  policy: z.unknown().optional(),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    // Admin endpoint protected by ADMIN_API_KEY header (see admin middleware)
    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid body', errors: parsed.error.flatten() }),
      };
    }

    const existing = await getTenant(parsed.data.tenantId);
    const policy: TenantPolicy = mergeTenantPolicy(parsed.data.policy ?? existing.policy);

    const next = {
      ...existing,
      name: parsed.data.name ?? existing.name,
      channels: parsed.data.channels ?? existing.channels,
      policy,
    };

    await saveTenant(next);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err: unknown) {
    const e = toHttpError(err);
    logger.error('adminUpsertTenant error', { err: e });
    return {
      statusCode: e.statusCode,
      body: JSON.stringify({ message: e.message, details: e.details }),
    };
  }
};
