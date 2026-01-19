import { Logger } from '@aws-lambda-powertools/logger';
import type { SQSEvent } from 'aws-lambda';
import { DateTime } from 'luxon';

import { sendTelegram } from '../core/channels/telegramSender';
import { sendWhatsApp } from '../core/channels/whatsappSender';
import { ConversationTurnRunner } from '../core/conversation/ConversationTurnRunner';
import { decideWithDialogueManager } from '../core/dialogue/dialogueManager';
import { maybeHandoff } from '../core/handoff/handoff';
import { writeResponse } from '../core/llm/responseWriter';
import { safetyFilter } from '../core/llm/safetyFilter';
import { nextBestAction } from '../core/nba/nextBestAction';
import { parseIntent } from '../core/nlu/parseIntent';
import { buildOffers } from '../core/offers/offerEngine';
import { buildEffectivePolicy } from '../core/policy/effectivePolicy';
import { policyCheck } from '../core/policy/policyCheck';
import { redeemTelegramEnrollmentCode } from '../core/store/enrollmentCodes';
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
  resolveDebtorIfExists,
} from '../core/store/repos';
import { enforcePlaybookOnNba } from '../core/strategy/enforcePlaybook';
import { computeConversationStrategy } from '../core/strategy/strategy';
import type { NluResult, NormalizedInboundEvent } from '../core/types';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

function minuteKeyUtc(iso: string): string {
  // ISO like 2026-01-18T19:22:01.123Z -> minute bucket 2026-01-18T19:22
  return iso.slice(0, 16);
}

function pruneMinuteBuckets(map: Record<string, number>, keep = 30) {
  const keys = Object.keys(map).sort();
  while (keys.length > keep) {
    const k = keys.shift();
    if (k) delete map[k];
  }
}

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

      const userText = inbound.message.text ?? '';
      const maxInboundTextChars =
        effectivePolicy.conversationPolicy?.limits?.maxInboundTextChars ?? 800;
      if (userText.length > maxInboundTextChars) {
        // Drop oversized messages to prevent prompt stuffing / cost spikes.
        continue;
      }

      let debtor = await resolveDebtorIfExists(inbound.tenantId, inbound);
      if (!debtor) {
        const rawText = (inbound.message.text ?? '').trim();
        const upper = rawText.toUpperCase();

        // Allow Telegram users to enroll via a one-time code (24h TTL):
        // - "VINCULAR <CODE>" or "CODIGO <CODE>" or just "<CODE>"
        const maybeCode = (() => {
          const parts = rawText.split(/\s+/).filter(Boolean);
          if (
            parts.length === 2 &&
            ['VINCULAR', 'CODIGO', 'CÓDIGO'].includes(parts[0].toUpperCase())
          ) {
            return parts[1];
          }
          if (/^[A-Z0-9]{6,12}$/.test(upper)) return upper;
          return undefined;
        })();

        if (inbound.channel === 'telegram' && inbound.debtorRef.telegramUserId && maybeCode) {
          const redeemed = await redeemTelegramEnrollmentCode({
            tenantId: inbound.tenantId,
            telegramUserId: inbound.debtorRef.telegramUserId,
            telegramChatId: inbound.debtorRef.telegramChatId,
            code: maybeCode,
          });

          if (redeemed) {
            debtor = await resolveDebtorIfExists(inbound.tenantId, inbound);
            if (debtor) {
              logger.info('telegram enrollment redeemed', {
                tenantId: inbound.tenantId,
                debtorId: debtor.debtorId,
                telegramUserId: inbound.debtorRef.telegramUserId,
              });
            }
          }
        }
      }

      if (!debtor) {
        let pseudoDebtorId = `UNENROLLED#${inbound.channel}`;
        if (inbound.debtorRef.phoneE164) {
          pseudoDebtorId = `UNENROLLED#PHONE#${inbound.debtorRef.phoneE164}`;
        } else if (inbound.debtorRef.telegramUserId) {
          pseudoDebtorId = `UNENROLLED#TG#${inbound.debtorRef.telegramUserId}`;
        }

        const instructions = (() => {
          if (inbound.channel === 'telegram' && inbound.debtorRef.telegramUserId) {
            return (
              'Hola. Por seguridad, este canal solo atiende a personas previamente registradas.\n\n' +
              `Tu Telegram ID es: ${inbound.debtorRef.telegramUserId}.\n` +
              'Si ya tienes un código de vinculación, responde: VINCULAR <CÓDIGO>.\n' +
              'Si no, solicita a tu asesor/administrador que lo asocie a tu cuenta.'
            );
          }
          if (inbound.channel === 'whatsapp' && inbound.debtorRef.phoneE164) {
            return (
              'Hola. Por seguridad, este número debe estar registrado para poder ayudarte por WhatsApp.\n\n' +
              `Tu número es: ${inbound.debtorRef.phoneE164}.\n` +
              'Por favor solicita a tu asesor/administrador que lo asocie a tu cuenta.'
            );
          }
          return (
            'Hola. Por seguridad, no puedo continuar por este canal porque no está registrado. ' +
            'Por favor contacta a tu asesor/administrador para registrar tu canal.'
          );
        })();

        await putAudit({
          tenantId: inbound.tenantId,
          debtorId: pseudoDebtorId,
          channel: inbound.channel,
          direction: 'inbound',
          decisionPath: undefined,
          messageId: inbound.message.id,
          atIso: new Date().toISOString(),
          phoneE164: inbound.debtorRef.phoneE164,
          telegramUserId: inbound.debtorRef.telegramUserId,
          text: tenant.policy.auditPolicy.storeMessageText ? inbound.message.text : undefined,
          policy: undefined,
          ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
        });

        await putAudit({
          tenantId: inbound.tenantId,
          debtorId: pseudoDebtorId,
          channel: inbound.channel,
          direction: 'outbound',
          decisionPath: 'deterministic',
          messageId: inbound.message.id + ':unenrolled',
          atIso: new Date().toISOString(),
          phoneE164: inbound.debtorRef.phoneE164,
          telegramUserId: inbound.debtorRef.telegramUserId,
          text: tenant.policy.auditPolicy.storeMessageText ? instructions : undefined,
          policy: undefined,
          dm: undefined,
          ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
        });

        if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
          await sendTelegram({
            tenant,
            chatId: inbound.debtorRef.telegramChatId,
            text: instructions,
          });
        } else if (inbound.channel === 'whatsapp' && inbound.debtorRef.phoneE164) {
          await sendWhatsApp({ tenant, toE164: inbound.debtorRef.phoneE164, text: instructions });
        }

        continue;
      }

      const nowIso = new Date().toISOString();
      const existingContact = await getContact(inbound.tenantId, debtor.debtorId);

      // Inbound flood control: block further processing (and avoid LLM cost) when a debtor spams.
      const maxInboundPerMinute =
        effectivePolicy.conversationPolicy?.limits?.maxInboundPerMinute ?? 6;
      const blockForSeconds =
        effectivePolicy.conversationPolicy?.limits?.blockForSecondsOnInboundFlood ?? 300;

      const minuteKey = minuteKeyUtc(nowIso);
      const inboundMinute = { ...(existingContact.inboundMinute ?? {}) };
      inboundMinute[minuteKey] = (inboundMinute[minuteKey] ?? 0) + 1;
      pruneMinuteBuckets(inboundMinute, 30);

      const alreadyBlockedUntil = existingContact.blockedUntilIso;
      const isAlreadyBlocked =
        typeof alreadyBlockedUntil === 'string' &&
        new Date(alreadyBlockedUntil).getTime() > Date.now();

      const floodDetected = inboundMinute[minuteKey] > maxInboundPerMinute;
      const nextBlockedUntilIso = floodDetected
        ? new Date(Date.now() + blockForSeconds * 1000).toISOString()
        : undefined;

      // Mark direct contact (user initiated) + store flood counters.
      const contact =
        (await putContact(inbound.tenantId, debtor.debtorId, {
          lastDirectContactAt: nowIso,
          lastDirectContactChannel: inbound.channel,
          inboundMinute,
          blockedUntilIso:
            nextBlockedUntilIso ?? (isAlreadyBlocked ? alreadyBlockedUntil : undefined),
        })) ?? (await getContact(inbound.tenantId, debtor.debtorId));

      const blockedUntil = contact.blockedUntilIso;
      const isBlocked =
        typeof blockedUntil === 'string' && new Date(blockedUntil).getTime() > Date.now();
      if (isBlocked) {
        // Optional: send a single notice per block window to reduce ping-pong.
        const lastNotice = contact.lastBlockNoticeAt;
        const shouldNotify = !lastNotice || new Date(lastNotice).getTime() < Date.now() - 60_000;
        if (shouldNotify) {
          const text =
            'Recibimos muchos mensajes en poco tiempo. Para continuar, por favor intenta de nuevo en unos minutos.';

          await putContact(inbound.tenantId, debtor.debtorId, { lastBlockNoticeAt: nowIso });

          if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
            await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text });
          } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
            await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text });
          }
        }
        continue;
      }

      if (contact.caseStatus === 'CLOSED') {
        const reason = contact.caseCloseReason ? ` Motivo: ${contact.caseCloseReason}.` : '';
        const text =
          'Gracias por escribir. Este caso está marcado como cerrado por el equipo de atención.' +
          reason +
          ' Si necesitas ayuda o deseas reabrirlo, por favor contacta a tu asesor por los canales oficiales.';

        const safe = await safetyFilter({ text });

        await putAudit({
          tenantId: inbound.tenantId,
          debtorId: debtor.debtorId,
          channel: inbound.channel,
          direction: 'outbound',
          decisionPath: 'deterministic',
          messageId: inbound.message.id + ':caseClosed',
          atIso: new Date().toISOString(),
          phoneE164: debtor.phoneE164,
          telegramUserId: debtor.telegramUserId,
          text: tenant.policy.auditPolicy.storeMessageText ? safe : undefined,
          ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
        });

        if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
          await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text: safe });
        } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
          await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text: safe });
        }

        continue;
      }

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
        decisionPath: undefined,
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
          decisionPath: 'deterministic',
          messageId: inbound.message.id + ':policy',
          atIso: new Date().toISOString(),
          phoneE164: debtor.phoneE164,
          telegramUserId: debtor.telegramUserId,
          text: tenant.policy.auditPolicy.storeMessageText ? text : undefined,
          policy: tenant.policy.auditPolicy.storeDecisionPayloads ? policy : undefined,
          dm: undefined,
          ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
        });

        if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
          await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text });
        } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
          await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text });
        }
        continue;
      }

      const llmProviderConfigured = (() => {
        const raw = process.env.LLM_PROVIDER_JSON;
        if (!raw) return false;
        try {
          const parsed = JSON.parse(raw) as { provider?: string };
          const provider = typeof parsed?.provider === 'string' ? parsed.provider : undefined;
          if (!provider || provider === 'mock') return false;
          if (provider === 'openai') return Boolean(process.env.LLM_OPENAI_KEY_SECRET_ID);
          return true;
        } catch {
          return false;
        }
      })();

      if (process.env.DEBUG_CONVERSATION_PATH === 'true') {
        logger.info('conversation path gate', {
          tenantId: inbound.tenantId,
          channel: inbound.channel,
          envMultiAgent: process.env.CONVERSATION_MULTI_AGENT_ENABLED,
          tenantMultiAgentEnabled: Boolean(
            effectivePolicy.conversationPolicy?.multiAgentOrchestration?.enabled
          ),
          llmProviderConfigured,
        });
      }

      const multiAgentEnabled =
        process.env.CONVERSATION_MULTI_AGENT_ENABLED === 'true' &&
        Boolean(effectivePolicy.conversationPolicy?.multiAgentOrchestration?.enabled) &&
        llmProviderConfigured;

      if (multiAgentEnabled) {
        // Compliance guardrail: keep opt-out behavior deterministic and immediate.
        const optOutNlu = await parseIntent({ text: userText, conversation: conv });
        if (optOutNlu.intent === 'OPT_OUT') {
          await putContact(inbound.tenantId, debtor.debtorId, { optedOut: true });
          const text =
            "Entendido. No te volveremos a contactar por este canal. Si deseas reactivar, escribe 'Reactivar'.";

          await putAudit({
            tenantId: inbound.tenantId,
            debtorId: debtor.debtorId,
            channel: inbound.channel,
            direction: 'outbound',
            decisionPath: 'multi-agent',
            messageId: inbound.message.id + ':optout',
            atIso: new Date().toISOString(),
            phoneE164: debtor.phoneE164,
            telegramUserId: debtor.telegramUserId,
            text: tenant.policy.auditPolicy.storeMessageText ? text : undefined,
            nlu: tenant.policy.auditPolicy.storeDecisionPayloads ? optOutNlu : undefined,
            dm: undefined,
            ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
          });

          if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
            await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text });
          } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
            await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text });
          }
          continue;
        }

        const atIso = inbound.receivedAt || new Date().toISOString();

        // Multi-agent pipeline must use the effective policy snapshot (country+tenant merge).
        const tenantForMultiAgent = { ...tenant, policy: effectivePolicy };

        const turn = await ConversationTurnRunner.runTurn({
          tenant: tenantForMultiAgent,
          debtor,
          conversation: conv,
          userText,
          channel: inbound.channel,
          messageId: inbound.message.id,
          atIso,
        });

        // Optional handoff using existing policy rules (based on LLM-driven classifier).
        if (turn.handoffIntent) {
          const nluForHandoff: NluResult = {
            intent: turn.handoffIntent,
            entities: {},
            confidence: turn.handoffConfidence ?? 0.8,
            topicShift: false,
          };

          const handoffRes = await maybeHandoff({
            tenant,
            debtor,
            nlu: nluForHandoff,
            inboundText: userText,
            channel: inbound.channel,
            conversationKey: `${inbound.channel}#${debtor.debtorId}`,
          });

          if (handoffRes.handedOff) {
            const text = `Gracias por contarnos. Para ayudarte correctamente, voy a escalar tu caso con un asesor.
Por favor comparte (si puedes): fecha del hecho/pago, valor involucrado y cualquier número de comprobante o referencia.`;

            const safe = await safetyFilter({ text });

            if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
              await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text: safe });
            } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
              await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text: safe });
            }

            // counters per tenant timezone
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

            await putAudit({
              tenantId: inbound.tenantId,
              debtorId: debtor.debtorId,
              channel: inbound.channel,
              direction: 'outbound',
              decisionPath: 'multi-agent',
              messageId: inbound.message.id + ':handoff',
              atIso,
              phoneE164: debtor.phoneE164,
              telegramUserId: debtor.telegramUserId,
              text: tenant.policy.auditPolicy.storeMessageText ? safe : undefined,
              nlu: tenant.policy.auditPolicy.storeDecisionPayloads ? nluForHandoff : undefined,
              dm: tenant.policy.auditPolicy.storeDecisionPayloads
                ? ({ multiAgentTurnId: turn.turnId } as unknown)
                : undefined,
              ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
            });

            const nextConv = {
              ...turn.nextConversation,
              state: 'HANDOFF',
              slots: {
                ...(turn.nextConversation.slots ?? {}),
                handedOff: true,
                handoffCaseId: handoffRes.caseId,
              },
              lastContactAt: atIso,
            };
            await putConversation(inbound.tenantId, debtor.debtorId, inbound.channel, nextConv);
            continue;
          }
        }

        const safe = await safetyFilter({ text: turn.replyText });

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

        await putAudit({
          tenantId: inbound.tenantId,
          debtorId: debtor.debtorId,
          channel: inbound.channel,
          direction: 'outbound',
          decisionPath: 'multi-agent',
          messageId: inbound.message.id + ':reply',
          atIso,
          phoneE164: debtor.phoneE164,
          telegramUserId: debtor.telegramUserId,
          text: tenant.policy.auditPolicy.storeMessageText ? safe : undefined,
          policy: tenant.policy.auditPolicy.storeDecisionPayloads ? policy : undefined,
          dm: tenant.policy.auditPolicy.storeDecisionPayloads
            ? ({ multiAgentTurnId: turn.turnId } as unknown)
            : undefined,
          ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
        });

        const mergedSlots = {
          ...(turn.nextConversation.slots ?? {}),
          ...(turn.promise
            ? { promiseAmount: turn.promise.amountCop, promiseDate: turn.promise.dateIso }
            : {}),
        };

        const nextConv = {
          ...turn.nextConversation,
          slots: mergedSlots,
          lastContactAt: atIso,
        };
        await putConversation(inbound.tenantId, debtor.debtorId, inbound.channel, nextConv);

        if (turn.promise) {
          // 9am Bogota ~= 14:00Z (Bogota is UTC-5)
          const dueAt = new Date(`${turn.promise.dateIso}T14:00:00.000Z`).toISOString();
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
              message: `Recordatorio: tu promesa de pago por $${turn.promise.amountCop.toLocaleString(
                'es-CO'
              )} es hoy.`,
            },
          });
        }

        continue;
      }

      const offers = buildOffers({ tenantPolicy: effectivePolicy, debtor, conversation: conv });

      const dmEnabled = process.env.DIALOGUE_MANAGER_ENABLED === 'true';
      const dm = dmEnabled
        ? await decideWithDialogueManager({
            tenant,
            debtor,
            conversation: conv,
            userText,
            offers,
          })
        : undefined;

      const strategy = computeConversationStrategy({
        tenantPolicy: effectivePolicy,
        debtor,
      });

      const nlu = dm?.nlu ?? (await parseIntent({ text: userText, conversation: conv }));

      const dmAuditBase = dm?.decision;

      // Optional human handoff routing (ANGRY / DISPUTE for MID+ etc.)
      const handoffRes = await maybeHandoff({
        tenant,
        debtor,
        nlu,
        inboundText: userText,
        channel: inbound.channel,
        conversationKey: `${inbound.channel}#${debtor.debtorId}`,
      });

      if (handoffRes.handedOff) {
        const text = `Gracias por contarnos. Para ayudarte correctamente, voy a escalar tu caso con un asesor.
Por favor comparte (si puedes): fecha del hecho/pago, valor involucrado y cualquier número de comprobante o referencia.`;

        const safe = await safetyFilter({ text });

        if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
          await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text: safe });
        } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
          await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text: safe });
        }

        // counters per tenant timezone
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

        await putAudit({
          tenantId: inbound.tenantId,
          debtorId: debtor.debtorId,
          channel: inbound.channel,
          direction: 'outbound',
          decisionPath: 'deterministic',
          messageId: inbound.message.id + ':handoff',
          atIso: new Date().toISOString(),
          phoneE164: debtor.phoneE164,
          telegramUserId: debtor.telegramUserId,
          text: tenant.policy.auditPolicy.storeMessageText ? safe : undefined,
          nlu: tenant.policy.auditPolicy.storeDecisionPayloads ? nlu : undefined,
          dm: tenant.policy.auditPolicy.storeDecisionPayloads ? dmAuditBase : undefined,
          ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
        });

        const nextConv = {
          ...conv,
          state: 'HANDOFF',
          slots: { ...(conv.slots ?? {}), handedOff: true, handoffCaseId: handoffRes.caseId },
          lastIntent: nlu.intent,
          lastContactAt: new Date().toISOString(),
        };
        await putConversation(inbound.tenantId, debtor.debtorId, inbound.channel, nextConv);
        continue;
      }

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
          decisionPath: 'deterministic',
          messageId: inbound.message.id + ':optout',
          atIso: new Date().toISOString(),
          phoneE164: debtor.phoneE164,
          telegramUserId: debtor.telegramUserId,
          text: tenant.policy.auditPolicy.storeMessageText ? text : undefined,
          nlu: tenant.policy.auditPolicy.storeDecisionPayloads ? nlu : undefined,
          dm: tenant.policy.auditPolicy.storeDecisionPayloads ? dmAuditBase : undefined,
          ttl: auditTtlSeconds(tenant.policy.auditPolicy.retentionDays),
        });

        if (inbound.channel === 'telegram' && inbound.debtorRef.telegramChatId) {
          await sendTelegram({ tenant, chatId: inbound.debtorRef.telegramChatId, text });
        } else if (inbound.channel === 'whatsapp' && debtor.phoneE164) {
          await sendWhatsApp({ tenant, toE164: debtor.phoneE164, text });
        }
        continue;
      }

      const dmNbaEnforced =
        dm?.nba && strategy.playbook
          ? enforcePlaybookOnNba({ nba: dm.nba, nlu, strategy, offersCount: offers.length })
          : undefined;

      const nba =
        dmNbaEnforced?.nba ??
        dm?.nba ??
        nextBestAction({
          tenantPolicy: effectivePolicy,
          debtor,
          conversation: conv,
          nlu,
          offers,
        });

      const dmAudit =
        tenant.policy.auditPolicy.storeDecisionPayloads && dmAuditBase
          ? dmNbaEnforced?.enforcement
            ? ({
                ...dmAuditBase,
                enforcement: dmNbaEnforced.enforcement,
              } as unknown)
            : dmAuditBase
          : undefined;

      const draft =
        dm?.messageDraft ??
        (await writeResponse({ tenant, debtor, conversation: conv, nlu, nba, offers }));
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
      if (nba.action === 'COOLDOWN' || nba.action === 'END_REFUSAL') {
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
        decisionPath: dm ? 'dialogue-manager' : 'deterministic',
        messageId: inbound.message.id + ':reply',
        atIso: new Date().toISOString(),
        phoneE164: debtor.phoneE164,
        telegramUserId: debtor.telegramUserId,
        text: tenant.policy.auditPolicy.storeMessageText ? safe : undefined,
        policy: tenant.policy.auditPolicy.storeDecisionPayloads ? policy : undefined,
        nlu: tenant.policy.auditPolicy.storeDecisionPayloads ? nlu : undefined,
        nba: tenant.policy.auditPolicy.storeDecisionPayloads ? nba : undefined,
        dm: dmAudit,
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
