import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import type { Tenant } from '../types';

const sm = new SecretsManagerClient({});

async function getSecretString(secretIdOrArn: string): Promise<string> {
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretIdOrArn }));
  if (!res.SecretString) throw new Error('SecretString not found');
  return res.SecretString;
}

export async function sendWhatsApp(input: { tenant: Tenant; toE164: string; text: string }) {
  const wa = input.tenant.channels.whatsapp;
  if (!wa) throw new Error('Tenant has no WhatsApp channel configured');

  const token = await getSecretString(wa.accessTokenSecretId);
  const phoneNumberId = wa.phoneNumberId;
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: input.toE164.replace('+', ''), // WA expects digits; you may keep '+' depending on API; adjust if needed.
    type: 'text',
    text: { body: input.text },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`WhatsApp send failed: ${resp.status} ${errText}`);
  }

  return resp.json().catch(() => ({}));
}
