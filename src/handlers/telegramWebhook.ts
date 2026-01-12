import { Logger } from '@aws-lambda-powertools/logger';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { toHttpError } from '../core/errors';
import { resolveTenantFromTelegramBotKey } from '../core/store/repos';
import type { NormalizedInboundEvent } from '../core/types';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });
const sqs = new SQSClient({});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

type TelegramNormalizedText = {
  updateId?: number;
  messageId?: number;
  chatId?: number;
  fromId?: number;
  text?: string;
  raw: unknown;
};

function normalizeTelegramText(payload: unknown): TelegramNormalizedText | undefined {
  if (!isRecord(payload)) return undefined;

  const updateId = typeof payload.update_id === 'number' ? payload.update_id : undefined;

  const msg = payload.message;
  if (!isRecord(msg)) return undefined;

  const messageId = typeof msg.message_id === 'number' ? msg.message_id : undefined;
  const text = typeof msg.text === 'string' ? msg.text : undefined;

  const chat = msg.chat;
  const from = msg.from;

  const chatId = isRecord(chat) && typeof chat.id === 'number' ? chat.id : undefined;
  const fromId = isRecord(from) && typeof from.id === 'number' ? from.id : undefined;

  if (!chatId || !fromId || !text) return undefined;

  return { updateId, messageId, chatId, fromId, text, raw: payload };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    // Multi-tenant routing:
    // - Webhook path includes botKey: /webhooks/telegram/{botKey}
    // - Dynamo mapping: pk TG_BOT#<botKey>, sk TENANT -> tenantId
    const botKey = event.pathParameters?.botKey ?? '';
    const tenantId = await resolveTenantFromTelegramBotKey(botKey);

    // Verify Telegram webhook secret (optional but recommended).
    // If you configure setWebhook(..., secret_token=...), Telegram will include this header in every request.
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN || '';
    if (expectedSecret) {
      const secretHeader = getHeader(
        event.headers as unknown as Record<string, string | undefined>,
        'X-Telegram-Bot-Api-Secret-Token'
      );
      if (!secretHeader || secretHeader !== expectedSecret) {
        logger.warn('telegramWebhook invalid secret token', { botKey });
        return { statusCode: 401, body: 'unauthorized' };
      }
    }

    const payload = event.body ? (JSON.parse(event.body) as unknown) : undefined;
    const normalizedText = normalizeTelegramText(payload);

    // Ignore non-text updates for MVP
    if (!normalizedText) return { statusCode: 200, body: 'ok' };

    const telegramUserId = String(normalizedText.fromId);
    const chatId = String(normalizedText.chatId);

    const msgId = normalizedText.updateId
      ? `tg:update:${normalizedText.updateId}`
      : `tg:chat:${chatId}:msg:${normalizedText.messageId ?? Date.now()}`;

    const normalized: NormalizedInboundEvent = {
      tenantId,
      channel: 'telegram',
      debtorRef: { telegramUserId, telegramChatId: chatId },
      message: {
        id: msgId,
        type: 'text',
        text: normalizedText.text!,
        raw: normalizedText.raw,
      },
      receivedAt: new Date().toISOString(),
      meta: { botKey },
    };

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.INBOUND_QUEUE_URL!,
        MessageBody: JSON.stringify(normalized),
        MessageGroupId: `${tenantId}#TG#${telegramUserId}`,
        MessageDeduplicationId: normalized.message.id,
      })
    );

    return { statusCode: 200, body: 'ok' };
  } catch (err: unknown) {
    const http = toHttpError(err);
    logger.error('telegramWebhook error', { err: http });
    // Telegram retries on non-200. For safety, we return 200 but keep error logged.
    return { statusCode: 200, body: 'ok' };
  }
};
