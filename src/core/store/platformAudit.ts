import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';

import { ddb, TABLE_NAME } from './dynamo';

const PK = (tenantId: string) => `TENANT#${tenantId}`;

export async function putPlatformAudit(params: {
  tenantId: string;
  actorSub?: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  resource: string;
  payload?: unknown;
  retentionDays?: number;
}) {
  const atIso = new Date().toISOString();
  const ttlDays = params.retentionDays ?? Number(process.env.PLATFORM_AUDIT_RETENTION_DAYS ?? 180);
  const ttl = ttlDays > 0 ? Math.floor(Date.now() / 1000) + ttlDays * 86400 : undefined;

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: PK(params.tenantId),
        sk: `PLATFORM_AUDIT#${atIso}#${ulid()}`,
        tenantId: params.tenantId,
        atIso,
        actorSub: params.actorSub,
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        action: params.action,
        resource: params.resource,
        payload: params.payload,
        ttl,
      },
    })
  );
}
