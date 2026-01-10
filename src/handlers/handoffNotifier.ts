import { Logger } from '@aws-lambda-powertools/logger';
import type { SQSEvent } from 'aws-lambda';

import { sendOpsEmail } from '../core/notifications/email';
import { getHandoffCase, getTenant, putHandoffEvent } from '../core/store/repos';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

function ttlSeconds(days?: number): number | undefined {
  if (!days || days <= 0) return undefined;
  return Math.floor(Date.now() / 1000) + days * 86400;
}

export const handler = async (event: SQSEvent) => {
  for (const rec of event.Records) {
    const msg = JSON.parse(rec.body);
    const { tenantId, caseSk } = msg;

    try {
      const tenant = await getTenant(tenantId);

      const emailCfg = tenant.policy.notificationPolicy.email;
      if (!emailCfg.enabled) continue;

      const caseItem = await getHandoffCase({ tenantId, caseSk });
      if (!caseItem) {
        logger.warn('handoff case not found', { tenantId, caseSk });
        continue;
      }

      const recipients = [...(emailCfg.toAddresses ?? [])];

      // If case assigned, include assignee email as well (MVP)
      if (caseItem.assignedToEmail) recipients.push(caseItem.assignedToEmail);

      // de-dup
      const to = Array.from(new Set(recipients)).filter(Boolean);

      if (!to.length) {
        logger.warn('no email recipients configured', { tenantId });
        continue;
      }

      const subject = `${emailCfg.subjectPrefix} Handoff ${caseItem.status} | ${caseItem.intent} | ${caseItem.stage}`;
      const lines: string[] = [];
      lines.push(`Tenant: ${tenantId}`);
      lines.push(`CaseId: ${caseItem.caseId}`);
      lines.push(`Status: ${caseItem.status}`);
      lines.push(`Stage: ${caseItem.stage}`);
      lines.push(`Intent: ${caseItem.intent} (${caseItem.confidence})`);
      lines.push(`Channel: ${caseItem.channel}`);
      lines.push(`DebtorId: ${caseItem.debtorId}`);
      if (caseItem.priority) lines.push(`Priority: ${caseItem.priority}`);
      if (caseItem.tags?.length) lines.push(`Tags: ${caseItem.tags.join(', ')}`);
      if (caseItem.assignedToEmail) lines.push(`AssignedTo: ${caseItem.assignedToEmail}`);
      if (emailCfg.includeInboundText && caseItem.inboundText) {
        lines.push('');
        lines.push('Inbound (snippet):');
        lines.push(caseItem.inboundText);
      }
      lines.push('');
      lines.push('Admin API:');
      lines.push(`- List open: GET /platform/handoffs?tenantId=${tenantId}`);
      lines.push(`- Close: POST /platform/handoffs/close`);
      lines.push(`- Assign: POST /platform/handoffs/assign`);

      await sendOpsEmail({
        tenant,
        to,
        subject,
        textBody: lines.join('\n'),
      });

      await putHandoffEvent({
        tenantId,
        caseId: caseItem.caseId,
        caseSk,
        type: 'EMAIL_SENT',
        payload: { to, subject },
        ttl: ttlSeconds(tenant.policy.handoffPolicy.retentionDays),
      });
    } catch (err: unknown) {
      logger.error('handoffNotifier failed', { err, tenantId, caseSk });
      throw err;
    }
  }
};
