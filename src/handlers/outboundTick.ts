import { Logger } from '@aws-lambda-powertools/logger';
import { DateTime } from 'luxon';

import { sendTelegram } from '../core/channels/telegramSender';
import { sendWhatsApp } from '../core/channels/whatsappSender';
import { writeResponse } from '../core/llm/responseWriter';
import { safetyFilter } from '../core/llm/safetyFilter';
import { nextBestAction } from '../core/nba/nextBestAction';
import { buildOffers } from '../core/offers/offerEngine';
import { buildEffectivePolicy } from '../core/policy/effectivePolicy';
import { policyCheck } from '../core/policy/policyCheck';
import {
  bumpOutboundCounters,
  getContact,
  getConversation,
  getCountryPolicy,
  getTenant,
  listDebtorsForTenant,
  listTenants,
  putAudit,
  putContact,
} from '../core/store/repos';
import type { NluResult } from '../core/types';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

function auditTtlSeconds(retentionDays: number | undefined): number | undefined {
  if (!retentionDays || retentionDays <= 0) return undefined;
  return Math.floor(Date.now() / 1000) + retentionDays * 86400;
}

function chooseChannel(debtor: { phoneE164?: string; telegramUserId?: string }) {
  if (debtor.phoneE164) return 'whatsapp' as const;
  if (debtor.telegramUserId) return 'telegram' as const;
  return undefined;
}

/**
 * Scheduled outbound tick.
 *
 * MVP behavior:
 * - Iterates tenants from registry (pk="TENANTS")
 * - Iterates up to N debtors per tenant (query begins_with "DEBTOR#")
 * - Applies policyCheck(outbound) + cooldown gates
 * - Sends a proactive message that contains menu options
 *
 * This is intentionally simple; for scale, add a GSI on `nextContactAllowedAt` + shard tenants.
 */
export const handler = async () => {
  const now = new Date();
  const nowIso = now.toISOString();

  const tenantLimit = Number(process.env.OUTBOUND_TICK_TENANT_LIMIT ?? '25');
  const debtorLimit = Number(process.env.OUTBOUND_TICK_DEBTOR_LIMIT ?? '50');

  const tenants = await listTenants(tenantLimit);

  for (const t of tenants) {
    if (!t.tenantId) continue;
    const tenant = await getTenant(t.tenantId);
    if (!tenant) continue;

    const countryCode = tenant.policy.contactPolicy.countryCode || 'CO';
    const countryPolicy = await getCountryPolicy(countryCode);
    const effectivePolicy = countryPolicy
      ? buildEffectivePolicy({ countryPolicy, tenantPolicy: tenant.policy })
      : tenant.policy;

    const { items: debtors } = await listDebtorsForTenant({
      tenantId: tenant.tenantId,
      limit: debtorLimit,
    });

    for (const debtor of debtors) {
      const channel = chooseChannel(debtor);
      if (!channel) continue;

      // Conversation state is per-channel
      const conv = await getConversation(tenant.tenantId, debtor.debtorId, channel);
      const contact = await getContact(tenant.tenantId, debtor.debtorId);

      const pol = policyCheck({
        now,
        tenantPolicy: effectivePolicy,
        debtor,
        contact,
        channel,
        direction: 'outbound',
      });

      if (!pol.allowed) continue;

      // System "tick" intent to drive a proactive outreach NBA action.
      const nlu: NluResult = {
        intent: 'SYSTEM_TICK',
        entities: {},
        confidence: 1,
        topicShift: false,
      };

      const offers = buildOffers({ tenantPolicy: effectivePolicy, debtor, conversation: conv });
      const nba = nextBestAction({
        tenantPolicy: effectivePolicy,
        debtor,
        conversation: conv,
        nlu,
      });

      // Only send if it's a proactive action (prevents spamming fallback loops)
      if (nba.action !== 'PROACTIVE_OUTREACH') continue;

      const draft = await writeResponse({ tenant, debtor, conversation: conv, nlu, nba, offers });
      const safe = await safetyFilter({ text: draft });

      if (channel === 'whatsapp' && debtor.phoneE164) {
        await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text: safe });
      } else if (channel === 'telegram' && debtor.telegramUserId) {
        // NOTE: for MVP we assume telegramUserId is also chatId; in a real bot store chatId separately.
        await sendTelegram({ tenant, chatId: debtor.telegramUserId, text: safe });
      }

      // contact bookkeeping
      await putContact(tenant.tenantId, debtor.debtorId, { lastOutboundAt: nowIso });

      // counters per tenant timezone
      const zone = tenant.policy.contactPolicy.timezone || 'America/Bogota';
      const dt = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(zone);
      const dayKey = dt.toISODate() as string;
      const weekKey = `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;
      await bumpOutboundCounters({
        tenantId: tenant.tenantId,
        debtorId: debtor.debtorId,
        dayKey,
        weekKey,
      });

      // audit outbound
      await putAudit({
        tenantId: tenant.tenantId,
        debtorId: debtor.debtorId,
        channel,
        direction: 'outbound',
        messageId: `tick:${nowIso}:${debtor.debtorId}`,
        atIso: nowIso,
        phoneE164: debtor.phoneE164,
        telegramUserId: debtor.telegramUserId,
        text: tenant.policy.auditPolicy.storeMessageText ? safe : undefined,
        nlu: tenant.policy.auditPolicy.storeDecisionPayloads ? nlu : undefined,
        nba: tenant.policy.auditPolicy.storeDecisionPayloads ? nba : undefined,
        offers: tenant.policy.auditPolicy.storeDecisionPayloads ? offers : undefined,
        ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
      });
    }
  }

  logger.info('outbound tick completed', { tenants: tenants.length });
};
