import { Logger } from '@aws-lambda-powertools/logger';
import { DateTime } from 'luxon';

import { sendTelegram } from '../core/channels/telegramSender';
import { sendWhatsApp } from '../core/channels/whatsappSender';
import { policyCheck } from '../core/policy/policyCheck';
import {
  bumpOutboundCounters,
  deleteReminder,
  getContact,
  getTenant,
  listDueReminders,
  putAudit,
} from '../core/store/repos';
import type { DebtorSnapshot } from '../core/types';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

function auditTtlSeconds(retentionDays: number): number | undefined {
  if (!retentionDays || retentionDays <= 0) return undefined;
  return Math.floor(Date.now() / 1000) + retentionDays * 86400;
}

export const handler = async () => {
  const nowIso = new Date().toISOString();
  const due = await listDueReminders(nowIso, 25);

  for (const item of due) {
    try {
      const tenantId = item.tenantId as string;
      const tenant = await getTenant(tenantId);

      const payload = (item.payload ?? {}) as Record<string, unknown>;

      // Strongly-typed reminder payload expected shape
      type ReminderPayload = {
        debtorId: string;
        debtor?: DebtorSnapshot;
        channel?: 'whatsapp' | 'telegram';
        chatId?: string;
        toE164?: string;
        telegramUserId?: string;
        message?: string;
      };

      function isReminderPayload(p: Record<string, unknown>): p is ReminderPayload {
        return (
          typeof p.debtorId === 'string' &&
          (p.channel === undefined || p.channel === 'whatsapp' || p.channel === 'telegram')
        );
      }

      if (!isReminderPayload(payload)) {
        logger.warn('reminder payload invalid', { tenantId, payload });
        // delete malformed reminder to avoid repeated failures
        await deleteReminder(item.pk as string, item.sk as string);
        continue;
      }

      const debtorId = payload.debtorId;

      const contact = await getContact(tenantId, debtorId);

      if (!payload.debtor) {
        logger.warn('reminder missing debtor snapshot', { tenantId, debtorId });
        await deleteReminder(item.pk as string, item.sk as string);
        continue;
      }

      const policy = policyCheck({
        now: new Date(),
        tenantPolicy: tenant.policy,
        debtor: payload.debtor as DebtorSnapshot,
        contact,
        channel: payload.channel as 'whatsapp' | 'telegram',
        direction: 'outbound',
      });

      if (!policy.allowed) {
        logger.info('reminder blocked by policy', { tenantId, debtorId, policy });
        continue;
      }

      const text = String(payload.message ?? '');

      if (payload.channel === 'telegram' && typeof payload.chatId === 'string') {
        await sendTelegram({ tenant, chatId: payload.chatId, text });
      } else if (payload.channel === 'whatsapp' && typeof payload.toE164 === 'string') {
        await sendWhatsApp({ tenant, toE164: payload.toE164, text });
      } else {
        logger.warn('reminder payload missing routing info', { tenantId, debtorId, payload });
        continue;
      }

      // increment outbound counters (tenant local)
      const zone = tenant.policy.contactPolicy.timezone || 'America/Bogota';
      const dt = DateTime.fromJSDate(new Date(), { zone: 'utc' }).setZone(zone);
      const dayKey = dt.toISODate() as string;
      const weekKey = `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;
      await bumpOutboundCounters({ tenantId, debtorId, dayKey, weekKey });

      // audit outbound reminder
      await putAudit({
        tenantId,
        debtorId,
        channel: payload.channel,
        direction: 'outbound',
        messageId: (item.sk as string) + ':send',
        atIso: new Date().toISOString(),
        phoneE164: payload.toE164,
        telegramUserId: payload.telegramUserId,
        text: tenant.policy.auditPolicy.storeMessageText ? text : undefined,
        policy: tenant.policy.auditPolicy.storeDecisionPayloads ? policy : undefined,
        ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
      });

      // remove reminder after successful send
      await deleteReminder(item.pk as string, item.sk as string);
    } catch (err: unknown) {
      logger.error('remindersTick failed', { err, item });
      // do not throw; continue other reminders
    }
  }
};
