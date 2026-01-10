import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

import type { Tenant } from '../types';

const TABLE_NAME = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const PK = (tenantId: string) => `TENANT#${tenantId}`;

export async function putTenantMeta(tenant: Tenant) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK(tenant.tenantId), sk: 'META', ...tenant },
    })
  );
}
