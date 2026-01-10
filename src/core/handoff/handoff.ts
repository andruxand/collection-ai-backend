import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import { createHandoffCase } from '../store/repos';
import type { DebtorSnapshot, NluResult, Tenant } from '../types';

const sqs = new SQSClient({});

export async function maybeHandoff(params: {
  tenant: Tenant;
  debtor: DebtorSnapshot;
  nlu: NluResult;
  inboundText: string;
  channel: 'whatsapp' | 'telegram';
  conversationKey: string;
}) {
  const policy = params.tenant.policy.handoffPolicy;
  if (!policy?.enabled) return { handedOff: false as const };

  const stageOrder = { EARLY: 1, MID: 2, LATE: 3 } as const;
  if (stageOrder[params.debtor.stage] < stageOrder[policy.stageMin])
    return { handedOff: false as const };

  const intent = params.nlu.intent;
  if (intent !== 'DISPUTE' && intent !== 'ANGRY') return { handedOff: false as const };
  if (!policy.intents.includes(intent)) return { handedOff: false as const };

  const retentionDays = policy.retentionDays ?? 30;
  const ttl = retentionDays > 0 ? Math.floor(Date.now() / 1000) + retentionDays * 86400 : undefined;
  const inboundText = policy.storeInboundText ? params.inboundText.slice(0, 1000) : undefined;

  const created = await createHandoffCase({
    tenantId: params.tenant.tenantId,
    debtorId: params.debtor.debtorId,
    channel: params.channel,
    intent: params.nlu.intent,
    confidence: params.nlu.confidence,
    stage: params.debtor.stage,
    inboundText,
    ttl,
  });

  const qurl = process.env.HANDOFF_QUEUE_URL;
  if (qurl) {
    const payload = {
      tenantId: params.tenant.tenantId,
      caseId: created.caseId,
      caseSk: created.sk,
      debtorId: params.debtor.debtorId,
      channel: params.channel,
      intent,
      confidence: params.nlu.confidence,
      conversationKey: params.conversationKey,
      atIso: new Date().toISOString(),
    };
    await sqs.send(
      new SendMessageCommand({ QueueUrl: qurl, MessageBody: JSON.stringify(payload) })
    );
  }

  return { handedOff: true as const, caseId: created.caseId, caseSk: created.sk };
}
