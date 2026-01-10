import { Logger } from '@aws-lambda-powertools/logger';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { ddb, TABLE_NAME } from '../core/store/dynamo';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });
const PK = (tenantId: string) => `TENANT#${tenantId}`;

const QuerySchema = z.object({
  tenantId: z.string().min(3),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requirePlatformAuth(event);
    const parsed = QuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success)
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid query', errors: parsed.error.flatten() }),
      };
    assertTenantAccess(parsed.data.tenantId, ctx);

    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pfx)',
        ExpressionAttributeValues: { ':pk': PK(parsed.data.tenantId), ':pfx': 'PLATFORM_AUDIT#' },
        ScanIndexForward: false,
        Limit: parsed.data.limit ?? 50,
      })
    );

    return { statusCode: 200, body: JSON.stringify({ ok: true, items: res.Items ?? [] }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformListAudit error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
