import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { generateClientApiKey, hashClientApiKeySecret } from '../core/auth/apiKey';
import { toHttpError } from '../core/errors';
import { putPlatformAudit } from '../core/store/platformAudit';
import { addClientApiKey } from '../core/store/repos';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const BodySchema = z.object({
  tenantId: z.string().min(3),
  label: z.string().max(60).optional(),
});

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

    const pepper = process.env.API_KEY_PEPPER;
    if (!pepper)
      return { statusCode: 500, body: JSON.stringify({ message: 'Missing API_KEY_PEPPER' }) };

    const { apiKey, keyId, secret } = generateClientApiKey();
    const hash = hashClientApiKeySecret(secret, pepper);

    await addClientApiKey({
      tenantId: parsed.data.tenantId,
      record: {
        keyId,
        label: parsed.data.label,
        status: 'ACTIVE',
        createdAtIso: new Date().toISOString(),
        hash,
      },
    });

    await putPlatformAudit({
      tenantId: parsed.data.tenantId,
      actorSub: ctx.actorSub,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.role,
      action: 'CLIENT_APIKEY_ISSUE',
      resource: `apikey:${keyId}`,
      payload: { label: parsed.data.label },
    });

    // Return the secret ONLY ONCE.
    return { statusCode: 200, body: JSON.stringify({ ok: true, apiKey, keyId }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformIssueClientApiKey error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
