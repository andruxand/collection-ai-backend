import { Logger } from '@aws-lambda-powertools/logger';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import type { NormalizedInboundEvent } from '../core/types';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });
const sqs = new SQSClient({});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const payload = event.body ? JSON.parse(event.body) : {};
    const msg = payload?.message;
    const text = msg?.text;
    const telegramUserId = msg?.from?.id ? String(msg.from.id) : undefined;
    const chatId = msg?.chat?.id ? String(msg.chat.id) : undefined;

    const tenantId =
      event.queryStringParameters?.tenantId ?? process.env.TENANT_DEFAULT_ID ?? 'tenant-demo';

    if (!text || !telegramUserId || !chatId) return { statusCode: 200, body: 'ok' };

    const normalized: NormalizedInboundEvent = {
      tenantId,
      channel: 'telegram',
      debtorRef: { telegramUserId, telegramChatId: chatId },
      message: {
        id: String(msg?.message_id ?? Date.now()),
        type: 'text',
        text,
        raw: payload,
      },
      receivedAt: new Date().toISOString(),
      meta: {},
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
    logger.error('telegramWebhook error', { err });
    return { statusCode: 200, body: 'ok' };
  }
};
