import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { Tenant } from '../types';

const TABLE_NAME = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const PK = (tenantId: string) => `TENANT#${tenantId}`;

export async function exportAuditForDate(params: { tenant: Tenant; date: string }) {
  const { tenant, date } = params;

  const bucket = tenant.policy.exportPolicy.s3Bucket!;
  const prefix = tenant.policy.exportPolicy.s3Prefix ?? `tenants/${tenant.tenantId}/audit/`;
  const key = `${prefix}${date}.jsonl`;

  // Query items for that date (sk begins with AUDIT#YYYY-MM-DD)
  const out: string[] = [];
  let lastKey: Record<string, unknown> | undefined = undefined;

  do {
    const res: QueryCommandOutput = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': PK(tenant.tenantId),
          ':sk': `AUDIT#${date}`,
        },
        ExclusiveStartKey: lastKey,
        Limit: 250,
      })
    );
    for (const item of res.Items ?? []) {
      out.push(JSON.stringify(item));
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  const body = out.join('\n') + (out.length ? '\n' : '');

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/x-ndjson',
    })
  );

  return { bucket, key, count: out.length };
}
