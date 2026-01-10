import { Logger } from '@aws-lambda-powertools/logger';
import type { SQSEvent } from 'aws-lambda';
import { DateTime } from 'luxon';

import { sendTelegram } from '../core/channels/telegramSender';
import { sendWhatsApp } from '../core/channels/whatsappSender';
import { maybeHandoff } from '../core/handoff/handoff';
import { writeResponse } from '../core/llm/responseWriter';
import { safetyFilter } from '../core/llm/safetyFilter';
import { nextBestAction } from '../core/nba/nextBestAction';
import { parseIntent } from '../core/nlu/parseIntent';
import { buildOffers } from '../core/offers/offerEngine';
import { buildEffectivePolicy } from '../core/policy/effectivePolicy';
import { policyCheck } from '../core/policy/policyCheck';
import {
  bumpOutboundCounters,
  ensureIdempotency,
  getContact,
  getConversation,
  getCountryPolicy,
  getTenant,
  putAudit,
  putContact,
  putConversation,
  putReminder,
  resolveDebtor,
} from '../core/store/repos';
import type { NormalizedInboundEvent } from '../core/types';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

function auditTtlSeconds(retentionDays: number | undefined): number | undefined {
  if (!retentionDays || retentionDays <= 0) return undefined;
  return Math.floor(Date.now() / 1000) + retentionDays * 24 * 60 * 60;
}

export const handler = async (event: SQSEvent) => {
  for (const rec of event.Records) {
    try {
      const inbound: NormalizedInboundEvent = JSON.parse(rec.body) as NormalizedInboundEvent;

      // Idempotency per inbound message id
      const ttlSeconds = Number(process.env.IDEMPOTENCY_TTL_SECONDS ?? 7 * 24 * 60 * 60);
      const ok = await ensureIdempotency(inbound.message.id, ttlSeconds);
      if (!ok) continue;

      const tenant = await getTenant(inbound.tenantId);
      if (!tenant) {
        return { statusCode: 404, body: JSON.stringify({ ok: false, message: 'Unknown tenant' }) };
      }

      const countryCode = tenant.policy.contactPolicy.countryCode || 'CO';
      const countryPolicy = await getCountryPolicy(countryCode);
      const effectivePolicy = countryPolicy
        ? buildEffectivePolicy({ countryPolicy, tenantPolicy: tenant.policy })
        : tenant.policy;

      const debtor = await resolveDebtor(inbound.tenantId, inbound);

      // Mark direct contact (user initiated) and keep the channel used.
      await putContact(inbound.tenantId, debtor.debtorId, {
        lastDirectContactAt: new Date().toISOString(),
        lastDirectContactChannel: inbound.channel,
      });

      const contact = await getContact(inbound.tenantId, debtor.debtorId);
      const conv = await getConversation(inbound.tenantId, debtor.debtorId, inbound.channel);

      const policy = policyCheck({
        now: new Date(),
        tenantPolicy: effectivePolicy,
        debtor,
        contact,
        channel: inbound.channel,
        direction: 'reply',
      });

      // Audit inbound (user message)
      await putAudit({
        tenantId: inbound.tenantId,
        debtorId: debtor.debtorId,
        channel: inbound.channel,
        direction: 'inbound',
        messageId: inbound.message.id,
        atIso: new Date().toISOString(),
        phoneE164: debtor.phoneE164,
        telegramUserId: debtor.telegramUserId,
        text: tenant.policy.auditPolicy.storeMessageText ? inbound.message.text : undefined,
        policy: tenant.policy.auditPolicy.storeDecisionPayloads ? policy : undefined,
        ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
      });

      if (!policy.allowed) {
        const text =
          'Gracias por tu mensaje. En este momento no podemos continuar por políticas de contacto. Si deseas, escribe más tarde.';
        await putAudit({
          tenantId: inbound.tenantId,
          debtorId: debtor.debtorId,
          channel: inbound.channel,
          direction: 'outbound',
          messageId: inbound.message.id + ':policy',
          atIso: new Date().toISOString(),
          phoneE164: debtor.phoneE164,
          telegramUserId: debtor.telegramUserId,
          text: tenant.policy.auditPolicy.storeMessageText ? text : undefined,
          policy: tenant.policy.auditPolicy.storeDecisionPayloads ? policy : undefined,
          ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
        });

        if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
          await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text });
        } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
          await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text });
        }
        continue;
      }

      const userText = inbound.message.text ?? '';
      const nlu = await parseIntent({ text: userText });

      // Optional human handoff routing (ANGRY / DISPUTE for MID+ etc.)
      await maybeHandoff({
        tenant,
        debtor,
        nlu,
        inboundText: userText,
        channel: inbound.channel,
        conversationKey: `${inbound.channel}#${debtor.debtorId}`,
      });

      // Handle opt-out immediately
      if (nlu.intent === 'OPT_OUT') {
        await putContact(inbound.tenantId, debtor.debtorId, { optedOut: true });
        const text =
          "Entendido. No te volveremos a contactar por este canal. Si deseas reactivar, escribe 'Reactivar'.";

        await putAudit({
          tenantId: inbound.tenantId,
          debtorId: debtor.debtorId,
          channel: inbound.channel,
          direction: 'outbound',
          messageId: inbound.message.id + ':optout',
          atIso: new Date().toISOString(),
          phoneE164: debtor.phoneE164,
          telegramUserId: debtor.telegramUserId,
          text: tenant.policy.auditPolicy.storeMessageText ? text : undefined,
          nlu: tenant.policy.auditPolicy.storeDecisionPayloads ? nlu : undefined,
          ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
        });

        if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
          await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text });
        } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
          await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text });
        }
        continue;
      }

      const offers = buildOffers({ tenantPolicy: effectivePolicy, debtor, conversation: conv });
      const nba = nextBestAction({
        tenantPolicy: effectivePolicy,
        debtor,
        conversation: conv,
        nlu,
      });

      const draft = await writeResponse({ tenant, debtor, conversation: conv, nlu, nba, offers });
      const safe = await safetyFilter({ text: draft });

      // Send outbound message
      if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
        await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text: safe });
      } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
        await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text: safe });
      }

      // Increment outbound counters (tenant local)
      const zone = tenant.policy.contactPolicy.timezone || 'America/Bogota';
      const dt = DateTime.fromJSDate(new Date(), { zone: 'utc' }).setZone(zone);
      const dayKey = dt.toISODate() as string;
      const weekKey = `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;
      await bumpOutboundCounters({
        tenantId: inbound.tenantId,
        debtorId: debtor.debtorId,
        dayKey,
        weekKey,
      });

      // Apply cooldown decisions to ContactState (used by outbound policy gate)
      if (nba.action === 'COOLDOWN') {
        await putContact(inbound.tenantId, debtor.debtorId, {
          nextContactAllowedAt: nba.nextContactAllowedAt,
        });
      }

      // Audit outbound decision path
      await putAudit({
        tenantId: inbound.tenantId,
        debtorId: debtor.debtorId,
        channel: inbound.channel,
        direction: 'outbound',
        messageId: inbound.message.id + ':reply',
        atIso: new Date().toISOString(),
        phoneE164: debtor.phoneE164,
        telegramUserId: debtor.telegramUserId,
        text: tenant.policy.auditPolicy.storeMessageText ? safe : undefined,
        policy: tenant.policy.auditPolicy.storeDecisionPayloads ? policy : undefined,
        nlu: tenant.policy.auditPolicy.storeDecisionPayloads ? nlu : undefined,
        nba: tenant.policy.auditPolicy.storeDecisionPayloads ? nba : undefined,
        offers: tenant.policy.auditPolicy.storeDecisionPayloads ? offers : undefined,
        ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
      });

      // Update conversation state (slots + state machine)
      const mergedSlots = { ...(conv.slots ?? {}), ...(nba.slotsUpdate ?? {}) };
      const nextAttemptCount = conv.attemptCount + (nba.action === 'SHOW_OFFERS' ? 1 : 0);

      const nextConv = {
        ...conv,
        state: nba.nextState,
        slots: mergedSlots,
        lastIntent: nlu.intent,
        lastContactAt: new Date().toISOString(),
        attemptCount: nextAttemptCount,
        nextContactAllowedAt:
          nba.action === 'COOLDOWN' ? nba.nextContactAllowedAt : conv.nextContactAllowedAt,
      };
      await putConversation(inbound.tenantId, debtor.debtorId, inbound.channel, nextConv);

      // If user created a promise -> schedule reminder for the promise date
      if (nba.action === 'CREATE_PROMISE') {
        const promiseDate = mergedSlots.promiseDate;
        const promiseAmount = mergedSlots.promiseAmount;

        if (typeof promiseDate === 'string' && typeof promiseAmount === 'number') {
          // 9am Bogota ~= 14:00Z (Bogota is UTC-5)
          const dueAt = new Date(`${promiseDate}T14:00:00.000Z`).toISOString();
          await putReminder({
            tenantId: inbound.tenantId,
            debtorId: debtor.debtorId,
            dueAt,
            kind: 'PROMISE_DUE',
            payload: {
              channel: inbound.channel,
              debtorId: debtor.debtorId,
              toE164: debtor.phoneE164,
              chatId: inbound.debtorRef.telegramChatId,
              message: `Recordatorio: tu promesa de pago por $${promiseAmount.toLocaleString(
                'es-CO'
              )} es hoy.`,
            },
          });
        }
      }
    } catch (err: unknown) {
      logger.error('orchestrator failed', { err, body: rec.body });
      throw err;
    }
  }
};
