import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { getAttr, listPlatformUsers } from '../core/platform/cognito';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const QuerySchema = z.object({
  tenantId: z.string().min(3),
});

function parseCsv(v?: string): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requirePlatformAuth(event);

    const parsed = QuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid query', errors: parsed.error.flatten() }),
      };
    }
    assertTenantAccess(parsed.data.tenantId, ctx);

    const userPoolId = process.env.PLATFORM_USER_POOL_ID;
    if (!userPoolId)
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Missing PLATFORM_USER_POOL_ID' }),
      };

    let token: string | undefined = undefined;
    const users: Array<Record<string, unknown>> = [];

    // small pagination for MVP
    for (let i = 0; i < 5; i++) {
      const res = await listPlatformUsers({ userPoolId, limit: 60, paginationToken: token });
      for (const u of res.Users ?? []) {
        const email = getAttr(u.Attributes, 'email');
        const tenantIds = parseCsv(
          getAttr(u.Attributes, 'custom:tenantIds') ?? getAttr(u.Attributes, 'tenantIds')
        );
        const role =
          getAttr(u.Attributes, 'custom:role') ?? getAttr(u.Attributes, 'role') ?? 'OPERATOR';
        const sub = getAttr(u.Attributes, 'sub');

        if (ctx.groups.includes('SUPER_ADMIN') || tenantIds.includes(parsed.data.tenantId)) {
          users.push({
            sub,
            email,
            role,
            enabled: u.Enabled,
            status: u.UserStatus,
            tenantIds,
          });
        }
      }
      token = res.PaginationToken;
      if (!token) break;
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, items: users }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformListOperators error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
