import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import {
  getContact,
  getConversation,
  lookupDebtorIdByPhone,
  lookupDebtorIdByTelegram,
} from '../core/store/repos';
import { requireClientAuth } from './_clientAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const QuerySchema = z
  .object({
    channel: z.enum(['whatsapp', 'telegram']),
    debtorId: z.string().min(1).optional(),
    phoneE164: z
      .string()
      .regex(/^\+\d{7,15}$/)
      .optional(),
    telegramUserId: z.string().min(1).optional(),
  })
  .refine((q) => Boolean(q.debtorId || q.phoneE164 || q.telegramUserId), {
    message: 'Provide debtorId or phoneE164 or telegramUserId',
  });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = await requireClientAuth(event);

    const queryRaw = event.queryStringParameters ?? {};
    const parsed = QuerySchema.safeParse(queryRaw);
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid query', errors: parsed.error.flatten() }),
      };
    }

    const { channel, debtorId, phoneE164, telegramUserId } = parsed.data;
    const tenantId = auth.tenantId;

    let resolvedDebtorId = debtorId;
    if (!resolvedDebtorId && phoneE164) {
      resolvedDebtorId = await lookupDebtorIdByPhone(tenantId, phoneE164);
    }
    if (!resolvedDebtorId && telegramUserId) {
      resolvedDebtorId = await lookupDebtorIdByTelegram(tenantId, telegramUserId);
    }

    if (!resolvedDebtorId) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: 'Debtor not found for tenant', found: false }),
      };
    }

    const [conversation, contact] = await Promise.all([
      getConversation(tenantId, resolvedDebtorId, channel),
      getContact(tenantId, resolvedDebtorId),
    ]);

    const nowIso = new Date().toISOString();
    const nextAllowed = contact.nextContactAllowedAt ?? conversation.nextContactAllowedAt;
    const canContactNow =
      contact.optedOut === true
        ? false
        : !nextAllowed || new Date(nextAllowed).getTime() <= Date.now();

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        tenantId,
        channel,
        debtorId: resolvedDebtorId,
        nowIso,
        canContactNow,
        conversation,
        contact,
      }),
    };
  } catch (err: unknown) {
    const e = toHttpError(err);
    logger.error('clientConversationStatus error', { err: e });
    return {
      statusCode: e.statusCode,
      body: JSON.stringify({ message: e.message, details: e.details }),
    };
  }
};
