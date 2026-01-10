import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import type { Tenant } from '../types';

const sm = new SecretsManagerClient({});

async function getSecretString(secretIdOrArn: string): Promise<string> {
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretIdOrArn }));
  if (!res.SecretString) throw new Error('SecretString not found');
  return res.SecretString;
}

export async function sendTelegram(input: { tenant: Tenant; chatId: string; text: string }) {
  const tg = input.tenant.channels.telegram;
  if (!tg) throw new Error('Tenant has no Telegram channel configured');

  const token = await getSecretString(tg.botTokenSecretId);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: input.chatId, text: input.text }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Telegram send failed: ${resp.status} ${errText}`);
  }

  return resp.json().catch(() => ({}));
}
