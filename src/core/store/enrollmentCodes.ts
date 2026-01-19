import crypto from 'node:crypto';

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { DebtorSnapshot } from '../types';
import { ddb, TABLE_NAME } from './dynamo';

const PK = (tenantId: string) => `TENANT#${tenantId}`;

export async function getDebtor(
  tenantId: string,
  debtorId: string
): Promise<DebtorSnapshot | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(tenantId), sk: `DEBTOR#${debtorId}` },
    })
  );
  return res.Item as DebtorSnapshot | undefined;
}

const ENROLL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomEnrollCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ENROLL_CODE_ALPHABET[bytes[i] % ENROLL_CODE_ALPHABET.length];
  }
  return out;
}

export async function createTelegramEnrollmentCode(params: {
  tenantId: string;
  debtorId: string;
  ttlHours?: number;
}): Promise<{ code: string; expiresAtIso: string }> {
  const ttlHours = params.ttlHours ?? 24;
  const now = Date.now();
  const expiresAtMs = now + ttlHours * 60 * 60 * 1000;
  const expiresAtIso = new Date(expiresAtMs).toISOString();
  const ttl = Math.floor(expiresAtMs / 1000);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomEnrollCode(8);
    const sk = `ENROLL#TG#${code}`;
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: PK(params.tenantId),
            sk,
            tenantId: params.tenantId,
            code,
            debtorId: params.debtorId,
            channel: 'telegram',
            createdAtIso: new Date(now).toISOString(),
            expiresAtIso,
            expiresAtEpoch: ttl,
            ttl,
          },
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        })
      );
      return { code, expiresAtIso };
    } catch {
      // retry on collision
    }
  }

  throw new Error('Could not create enrollment code');
}

export async function redeemTelegramEnrollmentCode(params: {
  tenantId: string;
  telegramUserId: string;
  telegramChatId?: string;
  code: string;
}): Promise<{ debtorId: string } | undefined> {
  const normalizedCode = params.code.trim().toUpperCase();
  if (!normalizedCode) return undefined;

  const sk = `ENROLL#TG#${normalizedCode}`;
  const nowIso = new Date().toISOString();
  const nowEpoch = Math.floor(Date.now() / 1000);

  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: PK(params.tenantId), sk },
        UpdateExpression:
          'SET consumedAtIso = :c, consumedByTelegramUserId = :u, consumedByTelegramChatId = :ch',
        ExpressionAttributeValues: {
          ':c': nowIso,
          ':u': params.telegramUserId,
          ':ch': params.telegramChatId ?? null,
          ':now': nowEpoch,
        },
        ConditionExpression:
          'attribute_exists(pk) AND attribute_exists(sk) AND attribute_not_exists(consumedAtIso) AND expiresAtEpoch > :now',
        ReturnValues: 'ALL_NEW',
      })
    );

    const item = res.Attributes as Record<string, unknown> | undefined;
    const debtorId = typeof item?.debtorId === 'string' ? item.debtorId : undefined;
    if (!debtorId) return undefined;

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: PK(params.tenantId),
          sk: `LOOKUP#TG#${params.telegramUserId}`,
          debtorId,
        },
      })
    );

    const debtor = await getDebtor(params.tenantId, debtorId);
    if (debtor) {
      const next: DebtorSnapshot = {
        ...debtor,
        telegramUserId: params.telegramUserId,
        consents: { ...debtor.consents, telegram: true },
      };
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { pk: PK(params.tenantId), sk: `DEBTOR#${debtorId}`, ...next },
        })
      );
    }

    return { debtorId };
  } catch {
    return undefined;
  }
}
