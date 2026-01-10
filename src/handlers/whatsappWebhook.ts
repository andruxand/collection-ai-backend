import crypto from 'node:crypto';

import { Logger } from '@aws-lambda-powertools/logger';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { resolveTenantFromWhatsApp } from '../core/store/repos';
import type { NormalizedInboundEvent } from '../core/types';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });
const sqs = new SQSClient({});
const sm = new SecretsManagerClient({});

async function getSecretString(secretIdOrArn: string): Promise<string> {
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretIdOrArn }));
  if (!res.SecretString) throw new Error('SecretString not found');
  return res.SecretString;
}

function timingSafeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function verifySignature(event: APIGatewayProxyEventV2): Promise<boolean> {
  const sig = event.headers?.['x-hub-signature-256'] ?? event.headers?.['X-Hub-Signature-256'];
  if (!sig) return false;

  const secretArn = process.env.META_APP_SECRET_ARN;
  if (!secretArn) throw new Error('Missing META_APP_SECRET_ARN');

  const appSecret = await getSecretString(secretArn);

  // IMPORTANT: need raw body exactly as received. event.body is raw (string). If base64, decode.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64')
    : Buffer.from(event.body ?? '', 'utf8');
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  return timingSafeEqual(expected, sig);
}

type WhatsAppNormalizedMessage = {
  phoneNumberId?: string;
  from?: string;
  messageId?: string;
  text?: string;
  type: string;
  raw: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeWhatsApp(payload: unknown): WhatsAppNormalizedMessage[] {
  const out: WhatsAppNormalizedMessage[] = [];
  if (!isRecord(payload)) return out;

  const entry = asArray((payload as Record<string, unknown>).entry);
  for (const e of entry) {
    if (!isRecord(e)) continue;
    const changes = asArray(e.changes);
    for (const c of changes) {
      if (!isRecord(c)) continue;
      const value = isRecord(c.value) ? c.value : undefined;
      if (!value) continue;
      const metadata = value.metadata;
      const phoneNumberId = isRecord(metadata)
        ? String(metadata.phone_number_id ?? metadata.phoneNumberId ?? '')
        : undefined;
      const messages = asArray(value.messages);
      for (const m of messages) {
        if (!isRecord(m)) continue;
        const from = typeof m.from === 'string' ? m.from : undefined;
        const messageId = typeof m.id === 'string' ? m.id : undefined;
        const type = typeof m.type === 'string' ? m.type : 'unknown';
        const text = isRecord(m.text) && typeof m.text.body === 'string' ? m.text.body : undefined;
        out.push({ phoneNumberId, from, messageId, text, type, raw: m });
      }
    }
  }
  return out;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    if (event.requestContext.http.method === 'GET') {
      const params = event.queryStringParameters ?? {};
      const mode = params['hub.mode'];
      const token = params['hub.verify_token'];
      const challenge = params['hub.challenge'];

      if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN && challenge) {
        return { statusCode: 200, body: challenge };
      }
      return { statusCode: 403, body: 'forbidden' };
    }

    // POST
    const ok = await verifySignature(event);
    if (!ok) {
      logger.warn('Invalid WhatsApp signature');
      return { statusCode: 401, body: 'unauthorized' };
    }

    const payload = event.body
      ? event.isBase64Encoded
        ? JSON.parse(Buffer.from(event.body, 'base64').toString('utf8'))
        : JSON.parse(event.body)
      : {};
    const messages = normalizeWhatsApp(payload);

    // Acknowledge fast (Meta expects quick 200). We enqueue and return.
    for (const m of messages) {
      if (!m.phoneNumberId || !m.from || !m.messageId) continue;

      const tenantId = await resolveTenantFromWhatsApp(m.phoneNumberId);

      const normalized: NormalizedInboundEvent = {
        tenantId,
        channel: 'whatsapp',
        debtorRef: {
          waFrom: m.from,
          phoneE164: m.from.startsWith('+') ? m.from : `+${m.from}`,
        },
        message: {
          id: m.messageId,
          type: m.type === 'text' ? 'text' : 'unknown',
          text: m.text,
          raw: m.raw,
        },
        receivedAt: new Date().toISOString(),
        meta: { phoneNumberId: m.phoneNumberId },
      };

      // FIFO ordering per debtor to avoid state races
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: process.env.INBOUND_QUEUE_URL!,
          MessageBody: JSON.stringify(normalized),
          MessageGroupId: `${tenantId}#${normalized.debtorRef.phoneE164 ?? m.from}`,
          MessageDeduplicationId: m.messageId,
        })
      );
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err: unknown) {
    logger.error('whatsappWebhook error', { err });
    // Return 200 to prevent retries storms; you still log and alarm.
    return { statusCode: 200, body: 'ok' };
  }
};
