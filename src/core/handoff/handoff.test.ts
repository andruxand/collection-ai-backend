import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TENANT_POLICY } from '../tenant/defaults';
import type { DebtorSnapshot, NluResult, Tenant } from '../types';

const sqsSend = vi.fn();

vi.mock('@aws-sdk/client-sqs', () => {
  return {
    SQSClient: vi.fn(() => ({ send: sqsSend })),
    SendMessageCommand: vi.fn((input: unknown) => ({ input })),
    __esModule: true,
  };
});

const createHandoffCase = vi.fn();

vi.mock('../store/repos', () => {
  return { createHandoffCase };
});

describe('maybeHandoff', () => {
  beforeEach(() => {
    createHandoffCase.mockReset();
    sqsSend.mockReset();
    process.env.HANDOFF_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/q';
  });

  it('creates a case and enqueues a notification when enabled and intent matches', async () => {
    createHandoffCase.mockResolvedValueOnce({
      caseId: 'c1',
      sk: 'HANDOFF#x#c1',
      createdAtIso: new Date().toISOString(),
    });

    const { maybeHandoff } = await import('./handoff');

    const tenant: Tenant = {
      tenantId: 't',
      name: 'Org',
      channels: {},
      policy: {
        ...DEFAULT_TENANT_POLICY,
        handoffPolicy: {
          enabled: true,
          stageMin: 'MID',
          intents: ['DISPUTE', 'ANGRY'],
          retentionDays: 30,
          storeInboundText: true,
        },
      },
    };

    const debtor: DebtorSnapshot = {
      tenantId: 't',
      debtorId: 'd1',
      totalDueCop: 100000,
      daysPastDue: 40,
      stage: 'MID',
      consents: { whatsapp: true, telegram: false },
    };

    const nlu: NluResult = { intent: 'DISPUTE', entities: {}, confidence: 0.8, topicShift: false };

    const res = await maybeHandoff({
      tenant,
      debtor,
      nlu,
      inboundText: 'no debo esto',
      channel: 'whatsapp',
      conversationKey: 'whatsapp#d1',
    });

    expect(res.handedOff).toBe(true);
    expect(createHandoffCase).toHaveBeenCalledTimes(1);
    expect(sqsSend).toHaveBeenCalledTimes(1);
  });
});
