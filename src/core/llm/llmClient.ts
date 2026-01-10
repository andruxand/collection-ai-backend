import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});

async function getSecretString(secretIdOrArn: string): Promise<string> {
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretIdOrArn }));
  if (!res.SecretString) throw new Error('SecretString not found');
  return res.SecretString;
}

type ProviderConfig = {
  provider: 'mock' | 'openai';
  model?: string; // e.g. gpt-4o-mini
  modelText?: string; // optional different model for copy
};

function parseProviderConfig(): ProviderConfig {
  const raw = process.env.LLM_PROVIDER_JSON;
  if (!raw) return { provider: 'mock' };
  try {
    return JSON.parse(raw) as ProviderConfig;
  } catch {
    return { provider: 'mock' };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Extracts the output text from an OpenAI Responses API response (best-effort). */
function extractOutputText(resp: unknown): string {
  if (!isRecord(resp)) return '';
  const output = resp['output'];
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!isRecord(item)) continue;
      const content = item['content'];
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!isRecord(part)) continue;
        if (part['type'] === 'output_text' && typeof part['text'] === 'string') return part['text'];
      }
    }
  }
  const outputText = resp['output_text'];
  return typeof outputText === 'string' ? outputText : '';
}

/**
 * Generates JSON (or best-effort object) using the configured LLM provider.
 *
 * - In MVP, the provider defaults to `mock`.
 * - When `jsonSchema` is provided and provider is OpenAI, we request `json_schema` strict output.
 * - When omitted, we request a generic JSON object output (best effort).
 */
export async function llmJson<T = unknown>(
  prompt: string,
  jsonSchema?: unknown,
  name = 'output'
): Promise<T> {
  const cfg = parseProviderConfig();

  if (cfg.provider === 'mock') {
    // Call-sites should validate with Zod and fall back if needed.
    return {} as T;
  }

  if (cfg.provider === 'openai') {
    const secretId = process.env.LLM_OPENAI_KEY_SECRET_ID;
    if (!secretId) throw new Error('Missing LLM_OPENAI_KEY_SECRET_ID');
    const apiKey = await getSecretString(secretId);

    const model = cfg.model ?? 'gpt-4o-mini';

    // NOTE: This is not executed in unit tests unless you set LLM_PROVIDER_JSON.
    const body: Record<string, unknown> = {
      model,
      input: [
        { role: 'system', content: 'Devuelve SOLO JSON válido.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      store: false,
    };

    if (jsonSchema) {
      body['text'] = {
        format: { type: 'json_schema', name, schema: jsonSchema, strict: true },
      };
    } else {
      body['text'] = {
        format: { type: 'json_object' },
      };
    }

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`LLM error: ${resp.status}`);
    const data: unknown = await resp.json();
    const text = extractOutputText(data);
    return JSON.parse(text || '{}') as T;
  }

  return {} as T;
}

export async function llmText(prompt: string): Promise<string> {
  const cfg = parseProviderConfig();
  if (cfg.provider === 'mock') return 'Hola. ¿Prefieres pagar hoy o hacer un acuerdo en cuotas?';

  if (cfg.provider === 'openai') {
    const secretId = process.env.LLM_OPENAI_KEY_SECRET_ID;
    if (!secretId) throw new Error('Missing LLM_OPENAI_KEY_SECRET_ID');
    const apiKey = await getSecretString(secretId);

    const model = cfg.modelText ?? cfg.model ?? 'gpt-4o-mini';

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content:
              'Responde breve, clara y respetuosa. Evita amenazas. Mantén enfoque en el acuerdo de pago.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_output_tokens: 220,
        store: false,
      }),
    });

    if (!resp.ok) throw new Error(`LLM error: ${resp.status}`);
    const data: unknown = await resp.json();
    return extractOutputText(data);
  }

  return '';
}
