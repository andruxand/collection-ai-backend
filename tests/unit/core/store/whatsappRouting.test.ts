import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-dynamodb', () => {
  return { DynamoDBClient: vi.fn(() => ({})) };
});

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class GetCommand {
    constructor(public input: any) {}
  }
  class PutCommand {
    constructor(public input: any) {}
  }
  class QueryCommand {
    constructor(public input: any) {}
  }
  class UpdateCommand {
    constructor(public input: any) {}
  }

  return {
    DynamoDBDocumentClient: { from: vi.fn(() => ({ send: sendMock })) },
    GetCommand,
    PutCommand,
    QueryCommand,
    UpdateCommand,
  };
});

describe('WhatsApp tenant routing', () => {
  beforeEach(() => {
    sendMock.mockReset();
    process.env.TABLE_NAME = 't';
    process.env.TENANT_DEFAULT_ID = 'tenant-demo';
  });

  it('returns mapped tenant when mapping exists', async () => {
    sendMock.mockResolvedValueOnce({ Item: { tenantId: 'tenant-1' } });
    const { resolveTenantFromWhatsApp } = await import('@/core/store/repos');
    const tenantId = await resolveTenantFromWhatsApp('123');
    expect(tenantId).toBe('tenant-1');
  });

  it('falls back to default when mapping does not exist', async () => {
    sendMock.mockResolvedValueOnce({});
    const { resolveTenantFromWhatsApp } = await import('@/core/store/repos');
    const tenantId = await resolveTenantFromWhatsApp('missing');
    expect(tenantId).toBe('tenant-demo');
  });

  it('falls back to default when phoneNumberId is empty', async () => {
    const { resolveTenantFromWhatsApp } = await import('@/core/store/repos');
    const tenantId = await resolveTenantFromWhatsApp('');
    expect(tenantId).toBe('tenant-demo');
  });
});
