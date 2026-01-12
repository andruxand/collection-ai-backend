import { Logger } from '@aws-lambda-powertools/logger';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import type { Tenant } from '../types';

const sm = new SecretsManagerClient({});
const logger = new Logger({ serviceName: 'telegramSender' });

async function getSecretString(secretIdOrArn: string): Promise<string> {
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretIdOrArn }));
  if (!res.SecretString) throw new Error('SecretString not found');
  // Soporta formato JSON {"token": "..."} o string plano
  try {
    const parsed = JSON.parse(res.SecretString);
    if (typeof parsed === 'object' && parsed.token) return String(parsed.token);
  } catch {}
  return res.SecretString;
}

export async function sendTelegram(input: { tenant: Tenant; chatId: string; text: string }) {
  const tg = input.tenant.channels.telegram;
  if (!tg) throw new Error('Tenant has no Telegram channel configured');

  const token = (await getSecretString(tg.botTokenSecretId)).trim();
  logger.info('sendTelegram: token prefix', {
    prefix: token.slice(0, 10),
    secretId: tg.botTokenSecretId,
  });
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  logger.info('sendTelegram: constructed url', { url });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: input.chatId, text: input.text }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    logger.error('sendTelegram: failed response', { status: resp.status, errText });
    throw new Error(`Telegram send failed: ${resp.status} ${errText}`);
  }

  logger.info('sendTelegram: success');
  return resp.json().catch(() => ({}));
}
