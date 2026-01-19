import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn(() => ({})) }));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual: any = await vi.importActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: { from: vi.fn(() => ({ send: sendMock })) },
    GetCommand: class GetCommand {
      constructor(public input: any) {}
    },
    PutCommand: class PutCommand {
      constructor(public input: any) {}
    },
  };
});

describe('resolveTenantFromTelegramBotKey', () => {
  beforeEach(() => {
    sendMock.mockReset();
    process.env.TENANT_DEFAULT_ID = 'tenant-demo';
  });

  it('returns mapped tenant when mapping exists', async () => {
    const { resolveTenantFromTelegramBotKey } = await import('@/core/store/repos');
    sendMock.mockResolvedValueOnce({ Item: { tenantId: 'tenant-acme' } });
    const tenant = await resolveTenantFromTelegramBotKey('tg-acme');
    expect(tenant).toBe('tenant-acme');
  });

  it('falls back when mapping does not exist', async () => {
    const { resolveTenantFromTelegramBotKey } = await import('@/core/store/repos');
    sendMock.mockResolvedValueOnce({ Item: undefined });
    const tenant = await resolveTenantFromTelegramBotKey('unknown');
    expect(tenant).toBe('tenant-demo');
  });
});
