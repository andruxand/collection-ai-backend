import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'crypto';
import { ulid } from 'ulid';

import { withTenantDefaults } from '../tenant/defaults';
import type {
  ApiKeyRecord,
  ContactState,
  ConversationState,
  CountryPolicy,
  DebtorSnapshot,
  HandoffCase,
  NbaDecision,
  NluResult,
  NormalizedInboundEvent,
  Tenant,
  TenantStage,
} from '../types';
import { ddb, TABLE_NAME } from './dynamo';

function normalizeTenant(tenant: Tenant): Tenant {
  return withTenantDefaults(tenant);
}

function stripMetaItem(item: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...item };
  delete copy.pk;
  delete copy.sk;
  delete copy.gsi1pk;
  delete copy.gsi1sk;
  delete copy.ttl;
  return copy;
}

const PK = (tenantId: string) => `TENANT#${tenantId}`;

export async function getTenant(tenantId: string): Promise<Tenant> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(tenantId), sk: 'META' },
    })
  );
  if (!res.Item) {
    // MVP: bootstrap a demo tenant if missing
    const demo: Tenant = {
      tenantId,
      name: 'Demo Tenant',
      policy: {
        contactPolicy: {
          timezone: 'America/Bogota',
          countryCode: 'CO',
          maxContactsPerDay: 1,
          noMultichannelSameWeekAfterDirectContact: true,
          hours: {
            monFri: { from: '07:00', to: '19:00' },
            sat: { from: '08:00', to: '15:00' },
            sunBlocked: true,
            holidaysBlocked: true,
          },
        },
        contactLimitsByStage: {
          EARLY: { maxOutboundPerDay: 1, maxOutboundPerWeek: 1 },
          MID: { maxOutboundPerDay: 1, maxOutboundPerWeek: 3 },
          LATE: { maxOutboundPerDay: 1, maxOutboundPerWeek: 4 },
        },
        cooldowns: {
          rejectedOfferDays: 3,
          noResponseDays: 2,
          brokenPromiseDays: 1,
        },
        offerPolicy: {
          ladder: [
            { attempt: 1, maxDiscountPct: 0 },
            { attempt: 2, maxDiscountPct: 5 },
            { attempt: 3, maxDiscountPct: 10 },
          ],
          maxAttempts: 6,
          hardCapDiscountPct: 15,
        },
        auditPolicy: {
          retentionDays: 90,
          storeMessageText: true,
          storeDecisionPayloads: true,
        },
        exportPolicy: {
          enabled: false,
          s3Bucket: '',
          s3Prefix: `tenants/${tenantId}/audit/`,
        },
        notificationPolicy: {
          email: {
            enabled: true,
            fromAddress: 'REPLACE_ME_VERIFIED_SES_SENDER@example.com',
            toAddresses: ['REPLACE_ME_OPS_QUEUE@example.com'],
            subjectPrefix: '[CollectionsAI]',
            includeInboundText: true,
          },
        },
        handoffPolicy: {
          enabled: true,
          stageMin: 'MID',
          intents: ['DISPUTE', 'ANGRY'],
        },
        tonePolicy: { T1: 'amable', T2: 'directo', T3: 'formal' },
      },

      channels: {
        whatsapp: {
          phoneNumberId: process.env.META_PHONE_NUMBER_ID ?? 'REPLACE_ME',
          accessTokenSecretId: process.env.META_ACCESS_TOKEN_SECRET_ID ?? 'REPLACE_ME',
        },
        telegram: {
          botTokenSecretId: process.env.TELEGRAM_BOT_TOKEN_SECRET_ID ?? 'REPLACE_ME',
        },
      },
    };
    await saveTenant(demo);
    return normalizeTenant(demo);
  }
  return normalizeTenant(stripMetaItem(res.Item as Record<string, unknown>) as unknown as Tenant);
}
// TELEGRAM
export async function putTelegramBotTenantMapping(params: { botKey: string; tenantId: string }) {
  const { botKey, tenantId } = params;
  if (!botKey) throw new Error('botKey is required');
  if (!tenantId) throw new Error('tenantId is required');

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `TG_BOT#${botKey}`,
        sk: 'TENANT',
        tenantId,
      },
    })
  );
}

export async function resolveTenantFromTelegramBotKey(botKey: string): Promise<string> {
  if (!botKey) {
    const fallback = process.env.TENANT_DEFAULT_ID ?? 'tenant-demo';
    return fallback;
  }

  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `TG_BOT#${botKey}`, sk: 'TENANT' },
    })
  );

  const item = res.Item as Record<string, unknown> | undefined;
  const tenantId = typeof item?.tenantId === 'string' ? item.tenantId : undefined;

  return tenantId ?? process.env.TENANT_DEFAULT_ID ?? 'tenant-demo';
}

// WHATSAPP
export async function putWhatsAppPhoneTenantMapping(params: {
  phoneNumberId: string;
  tenantId: string;
}) {
  const { phoneNumberId, tenantId } = params;
  if (!phoneNumberId) throw new Error('phoneNumberId is required');
  if (!tenantId) throw new Error('tenantId is required');

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `WA_PHONE#${phoneNumberId}`,
        sk: 'TENANT',
        tenantId,
      },
    })
  );
}

export async function resolveTenantFromWhatsApp(phoneNumberId: string): Promise<string> {
  // Multi-tenant routing:
  // pk: WA_PHONE#<phoneNumberId>, sk: TENANT, tenantId
  if (!phoneNumberId) {
    const fallback = process.env.TENANT_DEFAULT_ID ?? 'tenant-demo';
    return fallback;
  }

  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `WA_PHONE#${phoneNumberId}`, sk: 'TENANT' },
    })
  );

  const item = res.Item as Record<string, unknown> | undefined;
  const tenantId = typeof item?.tenantId === 'string' ? item.tenantId : undefined;

  return tenantId ?? process.env.TENANT_DEFAULT_ID ?? 'tenant-demo';
}

export async function resolveDebtor(
  tenantId: string,
  inbound: NormalizedInboundEvent
): Promise<DebtorSnapshot> {
  // Resolve stable debtorId via lookup; otherwise fall back to channel-derived id.
  let debtorId: string | undefined;

  if (inbound.debtorRef.phoneE164) {
    debtorId = await lookupDebtorIdByPhone(tenantId, inbound.debtorRef.phoneE164);
    debtorId = debtorId ?? `PHONE#${inbound.debtorRef.phoneE164}`;
  } else if (inbound.debtorRef.telegramUserId) {
    debtorId = await lookupDebtorIdByTelegram(tenantId, inbound.debtorRef.telegramUserId);
    debtorId = debtorId ?? `TG#${inbound.debtorRef.telegramUserId}`;
  } else {
    debtorId = `UNKNOWN#${ulid()}`;
  }

  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(tenantId), sk: `DEBTOR#${debtorId}` },
    })
  );
  if (res.Item) return res.Item as DebtorSnapshot;

  // Minimal placeholder (unknown debtor). You can route to human later.
  const placeholder: DebtorSnapshot = {
    tenantId,
    debtorId,
    phoneE164: inbound.debtorRef.phoneE164,
    telegramUserId: inbound.debtorRef.telegramUserId,
    totalDueCop: 0,
    daysPastDue: 0,
    stage: 'EARLY',
    consents: {
      whatsapp: Boolean(inbound.debtorRef.phoneE164),
      telegram: Boolean(inbound.debtorRef.telegramUserId),
    },
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK(tenantId), sk: `DEBTOR#${debtorId}`, ...placeholder },
    })
  );

  // Persist lookup so future messages resolve same id
  if (inbound.debtorRef.phoneE164) {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { pk: PK(tenantId), sk: `LOOKUP#PHONE#${inbound.debtorRef.phoneE164}`, debtorId },
      })
    );
  }
  if (inbound.debtorRef.telegramUserId) {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { pk: PK(tenantId), sk: `LOOKUP#TG#${inbound.debtorRef.telegramUserId}`, debtorId },
      })
    );
  }

  return placeholder;
}

export async function getConversation(
  tenantId: string,
  debtorId: string,
  channel: string
): Promise<ConversationState> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(tenantId), sk: `CONV#${channel}#${debtorId}` },
    })
  );
  if (!res.Item) {
    return { state: 'WELCOME', slots: {}, attemptCount: 1 };
  }
  return res.Item as ConversationState;
}

export async function putConversation(
  tenantId: string,
  debtorId: string,
  channel: string,
  conv: ConversationState
) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK(tenantId), sk: `CONV#${channel}#${debtorId}`, ...conv },
    })
  );
}

export async function logEvent(
  tenantId: string,
  debtorId: string,
  type: string,
  meta: Record<string, unknown>
) {
  const id = ulid();
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: PK(tenantId),
        sk: `EVT#${new Date().toISOString()}#${id}#${debtorId}`,
        type,
        meta,
      },
    })
  );
}

export async function ensureIdempotency(messageId: string, ttlSeconds: number): Promise<boolean> {
  // Returns true if this message is new (not processed).
  const now = Math.floor(Date.now() / 1000);
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `MSG#${messageId}`,
          sk: 'META',
          createdAt: new Date().toISOString(),
          ttl: now + ttlSeconds,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function putReminder(params: {
  tenantId: string;
  debtorId: string;
  dueAt: string;
  kind: string;
  payload: Record<string, unknown>;
}) {
  const id = ulid();
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: PK(params.tenantId),
        sk: `REM#${params.dueAt}#${id}#${params.debtorId}`,
        kind: params.kind,
        payload: params.payload,
        gsi1pk: 'REMINDER_DUE',
        gsi1sk: `${params.dueAt}#TENANT#${params.tenantId}#DEBTOR#${params.debtorId}`,
      },
    })
  );
}

export async function listDueReminders(nowIso: string, limit = 25) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk <= :now',
      ExpressionAttributeValues: {
        ':pk': 'REMINDER_DUE',
        ':now': `${nowIso}#Z`, // ensures lexicographic ceiling
      },
      Limit: limit,
    })
  );
  return res.Items ?? [];
}

export async function deleteReminder(pk: string, sk: string) {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
      UpdateExpression: 'SET ttl = :ttl',
      ExpressionAttributeValues: { ':ttl': Math.floor(Date.now() / 1000) - 10 },
    })
  );
}

export async function getContact(tenantId: string, debtorId: string): Promise<ContactState> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(tenantId), sk: `CONTACT#${debtorId}` },
    })
  );
  if (!res.Item) return { tenantId, debtorId };
  return res.Item as unknown as ContactState;
}

export async function putContact(tenantId: string, debtorId: string, patch: Partial<ContactState>) {
  const existing = await getContact(tenantId, debtorId);
  const next: ContactState = { ...existing, ...patch, tenantId, debtorId };
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK(tenantId), sk: `CONTACT#${debtorId}`, ...next },
    })
  );
  return next;
}

export async function bumpOutboundCounters(params: {
  tenantId: string;
  debtorId: string;
  dayKey: string; // YYYY-MM-DD (tenant local)
  weekKey: string; // YYYY-Www (tenant local)
}) {
  const { tenantId, debtorId, dayKey, weekKey } = params;
  const contact = await getContact(tenantId, debtorId);

  const daily = { ...(contact.outboundDaily ?? {}) };
  daily[dayKey] = (daily[dayKey] ?? 0) + 1;

  const weekly = { ...(contact.outboundWeekly ?? {}) };
  weekly[weekKey] = (weekly[weekKey] ?? 0) + 1;

  // prune old keys to keep item small (MVP heuristic)
  const pruneMap = (obj: Record<string, number>, keep: number) => {
    const keys = Object.keys(obj).sort();
    while (keys.length > keep) {
      const k = keys.shift();
      if (k) delete obj[k];
    }
  };
  pruneMap(daily, 40);
  pruneMap(weekly, 20);

  const next = await putContact(tenantId, debtorId, {
    outboundDaily: daily,
    outboundWeekly: weekly,
    lastOutboundAt: new Date().toISOString(),
  });
  return next;
}

export async function lookupDebtorIdByPhone(
  tenantId: string,
  phoneE164: string
): Promise<string | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(tenantId), sk: `LOOKUP#PHONE#${phoneE164}` },
    })
  );
  const item = res.Item as unknown as { debtorId?: string } | undefined;
  return item?.debtorId;
}

export async function lookupDebtorIdByTelegram(
  tenantId: string,
  telegramUserId: string
): Promise<string | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(tenantId), sk: `LOOKUP#TG#${telegramUserId}` },
    })
  );
  const item = res.Item as unknown as { debtorId?: string } | undefined;
  return item?.debtorId;
}

export async function saveTenant(tenant: Tenant) {
  const normalized = normalizeTenant(tenant);

  // Store tenant config
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK(normalized.tenantId), sk: 'META', ...normalized },
    })
  );

  // Store registry entry (for scheduled jobs / multi-tenant operations)
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: 'TENANTS',
        sk: `TENANT#${normalized.tenantId}`,
        tenantId: normalized.tenantId,
        name: normalized.name,
        createdAtIso: new Date().toISOString(),
      },
    })
  );
}

export async function listTenants(limit = 25): Promise<Array<{ tenantId: string; name?: string }>> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'TENANTS' },
      Limit: limit,
    })
  );
  const items = (res.Items ?? [])
    .map((it) => {
      const tenantId = String((it as Record<string, unknown>).tenantId ?? '');
      const name = (it as Record<string, unknown>).name;
      return { tenantId, name: typeof name === 'string' ? name : undefined };
    })
    .filter((x) => x.tenantId.length > 0);
  return items;
}

export async function listDebtorsForTenant(params: {
  tenantId: string;
  limit?: number;
  exclusiveStartKey?: Record<string, unknown>;
}): Promise<{ items: DebtorSnapshot[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': PK(params.tenantId),
        ':sk': 'DEBTOR#',
      },
      Limit: params.limit ?? 50,
      ExclusiveStartKey: params.exclusiveStartKey as unknown as Record<string, unknown> | undefined,
    })
  );

  const items = (res.Items ?? []).map(
    (it) => stripMetaItem(it as Record<string, unknown>) as unknown as DebtorSnapshot
  );
  const lek = res.LastEvaluatedKey
    ? (res.LastEvaluatedKey as unknown as Record<string, unknown>)
    : undefined;
  return { items, lastEvaluatedKey: lek };
}

export async function listClientApiKeys(params: { tenantId: string }) {
  const tenant = await getTenant(params.tenantId);
  return tenant.clientAuth?.apiKeys ?? [];
}

export async function addClientApiKey(params: { tenantId: string; record: ApiKeyRecord }) {
  const tenant = await getTenant(params.tenantId);
  tenant.clientAuth = tenant.clientAuth ?? { apiKeys: [] };
  tenant.clientAuth.apiKeys = [...tenant.clientAuth.apiKeys, params.record];
  await saveTenant(tenant);
}

export async function disableClientApiKey(params: { tenantId: string; keyId: string }) {
  const tenant = await getTenant(params.tenantId);
  tenant.clientAuth = tenant.clientAuth ?? { apiKeys: [] };
  tenant.clientAuth.apiKeys = (tenant.clientAuth.apiKeys ?? []).map((k: ApiKeyRecord) =>
    k.keyId === params.keyId ? { ...k, status: 'DISABLED' } : k
  );
  await saveTenant(tenant);
}

export async function touchClientApiKey(params: { tenantId: string; keyId: string }) {
  const tenant = await getTenant(params.tenantId);
  tenant.clientAuth = tenant.clientAuth ?? { apiKeys: [] };
  const now = new Date().toISOString();
  tenant.clientAuth.apiKeys = (tenant.clientAuth.apiKeys ?? []).map((k: ApiKeyRecord) =>
    k.keyId === params.keyId ? { ...k, lastUsedAtIso: now } : k
  );
  await saveTenant(tenant);
}

export async function upsertDebtors(params: {
  tenantId: string;
  debtors: Array<{
    debtorId?: string;
    phoneE164?: string;
    telegramUserId?: string;
    totalDueCop: number;
    daysPastDue: number;
    dueDate?: string;
    stage?: 'EARLY' | 'MID' | 'LATE';
    consents?: { whatsapp?: boolean; telegram?: boolean };
  }>;
}) {
  for (const d of params.debtors) {
    const debtorId =
      d.debtorId ??
      (d.phoneE164
        ? `PHONE#${d.phoneE164}`
        : d.telegramUserId
        ? `TG#${d.telegramUserId}`
        : undefined);

    if (!debtorId) continue;

    const item: DebtorSnapshot = {
      tenantId: params.tenantId,
      debtorId,
      phoneE164: d.phoneE164,
      telegramUserId: d.telegramUserId,
      totalDueCop: d.totalDueCop,
      daysPastDue: d.daysPastDue,
      dueDate: d.dueDate,
      stage: d.stage ?? (d.daysPastDue <= 15 ? 'EARLY' : d.daysPastDue <= 60 ? 'MID' : 'LATE'),
      consents: {
        whatsapp: d.consents?.whatsapp ?? Boolean(d.phoneE164),
        telegram: d.consents?.telegram ?? Boolean(d.telegramUserId),
      },
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { pk: PK(params.tenantId), sk: `DEBTOR#${debtorId}`, ...item },
      })
    );

    if (d.phoneE164) {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { pk: PK(params.tenantId), sk: `LOOKUP#PHONE#${d.phoneE164}`, debtorId },
        })
      );
    }
    if (d.telegramUserId) {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { pk: PK(params.tenantId), sk: `LOOKUP#TG#${d.telegramUserId}`, debtorId },
        })
      );
    }
  }
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function createHandoffCase(params: {
  tenantId: string;
  debtorId: string;
  channel: 'whatsapp' | 'telegram';
  intent: NluResult['intent'];
  confidence: number;
  stage: TenantStage;
  inboundText?: string;
  ttl?: number;
}) {
  const caseId = ulid();
  const createdAtIso = new Date().toISOString();
  const sk = `HANDOFF#${createdAtIso}#${caseId}`;

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: PK(params.tenantId),
        sk,
        gsi1pk: `HANDOFF#OPEN#${params.tenantId}`,
        gsi1sk: `${createdAtIso}#${caseId}`,
        tenantId: params.tenantId,
        caseId,
        debtorId: params.debtorId,
        status: 'OPEN',
        createdAtIso,
        channel: params.channel,
        intent: params.intent,
        confidence: params.confidence,
        stage: params.stage,
        inboundText: params.inboundText,
        ttl: params.ttl,
      },
    })
  );

  return { caseId, sk, createdAtIso };
}

export async function closeHandoffCase(params: {
  tenantId: string;
  caseSk: string; // the SK of the original case
  reason?: string;
}) {
  // Move index pointer from OPEN -> CLOSED by updating gsi1pk
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(params.tenantId), sk: params.caseSk },
      UpdateExpression: 'SET #status = :s, gsi1pk = :g, updatedAtIso = :u, closeReason = :r',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': 'CLOSED',
        ':g': `HANDOFF#CLOSED#${params.tenantId}`,
        ':u': new Date().toISOString(),
        ':r': params.reason ?? null,
      },
    })
  );
}

export async function getHandoffCase(params: {
  tenantId: string;
  caseSk: string;
}): Promise<HandoffCase | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(params.tenantId), sk: params.caseSk },
    })
  );
  return res.Item as unknown as HandoffCase | undefined;
}

export async function updateHandoffCase(params: {
  tenantId: string;
  caseSk: string;
  patch: {
    assignedToEmail?: string | null;
    assignedToUserSub?: string | null;
    priority?: string | null;
    tags?: string[] | null;
    status?: 'OPEN' | 'CLOSED';
    closeReason?: string | null;
  };
}) {
  const now = new Date().toISOString();
  const sets = ['updatedAtIso = :u'];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':u': now };

  if (params.patch.assignedToEmail !== undefined) {
    sets.push('assignedToEmail = :a');
    sets.push('assignedAtIso = :aa');
    values[':a'] = params.patch.assignedToEmail;
    values[':aa'] = now;
  }
  if (params.patch.assignedToUserSub !== undefined) {
    sets.push('assignedToUserSub = :as');
    values[':as'] = params.patch.assignedToUserSub;
  }
  if (params.patch.priority !== undefined) {
    sets.push('priority = :p');
    values[':p'] = params.patch.priority;
  }
  if (params.patch.tags !== undefined) {
    sets.push('tags = :t');
    values[':t'] = params.patch.tags;
  }
  if (params.patch.status) {
    sets.push('#status = :s');
    names['#status'] = 'status';
    values[':s'] = params.patch.status;
    if (params.patch.status === 'CLOSED') {
      sets.push('closedAtIso = :c');
      values[':c'] = now;
      sets.push('gsi1pk = :g');
      values[':g'] = `HANDOFF#CLOSED#${params.tenantId}`;
      sets.push('closeReason = :r');
      values[':r'] = params.patch.closeReason ?? null;
    } else {
      sets.push('gsi1pk = :g');
      values[':g'] = `HANDOFF#OPEN#${params.tenantId}`;
    }
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK(params.tenantId), sk: params.caseSk },
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
    })
  );
}

export async function putHandoffEvent(params: {
  tenantId: string;
  caseId: string;
  caseSk: string;
  type: 'CREATED' | 'ASSIGNED' | 'CLOSED' | 'EMAIL_SENT';
  payload?: unknown;
  ttl?: number;
}) {
  const atIso = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: PK(params.tenantId),
        sk: `HANDOFF_EVENT#${params.caseId}#${atIso}#${params.type}`,
        tenantId: params.tenantId,
        caseId: params.caseId,
        caseSk: params.caseSk,
        type: params.type,
        atIso,
        payload: params.payload,
        ttl: params.ttl,
      },
    })
  );
}

export async function listHandoffEvents(params: {
  tenantId: string;
  caseId: string;
  limit?: number;
}) {
  const prefix = `HANDOFF_EVENT#${params.caseId}#`;
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :pfx)',
      ExpressionAttributeValues: {
        ':pk': PK(params.tenantId),
        ':pfx': prefix,
      },
      ScanIndexForward: false,
      Limit: params.limit ?? 100,
    })
  );
  return res.Items ?? [];
}

export async function listOpenHandoffCases(params: { tenantId: string; limit?: number }) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `HANDOFF#OPEN#${params.tenantId}`,
      },
      ScanIndexForward: false,
      Limit: params.limit ?? 50,
    })
  );
  return res.Items ?? [];
}

export async function putAudit(params: {
  tenantId: string;
  debtorId: string;
  channel: 'whatsapp' | 'telegram';
  direction: 'inbound' | 'outbound';
  messageId: string;
  atIso: string;
  phoneE164?: string;
  telegramUserId?: string;
  text?: string;
  policy?: unknown;
  nlu?: NluResult;
  nba?: NbaDecision;
  offers?: unknown;
  ttl?: number; // epoch seconds
}) {
  const phoneHash = params.phoneE164 ? sha256(params.phoneE164) : undefined;
  const sk = `AUDIT#${params.atIso}#${params.direction}#${params.messageId}`;
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: PK(params.tenantId),
        sk,
        tenantId: params.tenantId,
        debtorId: params.debtorId,
        channel: params.channel,
        direction: params.direction,
        messageId: params.messageId,
        atIso: params.atIso,
        phoneHash,
        telegramUserId: params.telegramUserId,
        text: params.text,
        policy: params.policy,
        nlu: params.nlu,
        nba: params.nba,
        offers: params.offers,
        ttl: params.ttl,
      },
    })
  );
}

// ------------------------
// Country Policies (per jurisdiction)
// ------------------------
const COUNTRY_REGISTRY_PK = 'COUNTRIES';

function countryPolicyKey(countryCode: string) {
  const cc = countryCode.toUpperCase();
  return { pk: `COUNTRY#${cc}`, sk: 'POLICY' };
}

export async function putCountryPolicy(policy: CountryPolicy) {
  const cc = policy.countryCode.toUpperCase();
  const nowIso = new Date().toISOString();
  const { pk, sk } = countryPolicyKey(cc);

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk,
        sk,
        entity: 'COUNTRY_POLICY',
        countryCode: cc,
        version: policy.version,
        updatedAtIso: policy.updatedAtIso || nowIso,
        policy,
      },
    })
  );

  // Registry (for listing countries without scans)
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: COUNTRY_REGISTRY_PK,
        sk: `COUNTRY#${cc}`,
        entity: 'COUNTRY_REGISTRY',
        countryCode: cc,
        updatedAtIso: nowIso,
      },
    })
  );
}

export async function getCountryPolicy(countryCode: string): Promise<CountryPolicy | undefined> {
  const cc = countryCode.toUpperCase();
  const { pk, sk } = countryPolicyKey(cc);
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk } }));
  const item = res.Item as { policy?: CountryPolicy } | undefined;
  return item?.policy;
}

export async function listCountries(limit = 50): Promise<string[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': COUNTRY_REGISTRY_PK },
      Limit: limit,
    })
  );
  return (res.Items ?? [])
    .map((it) => {
      const rec = it as unknown as Record<string, unknown>;
      const cc = typeof rec.countryCode === 'string' ? rec.countryCode : '';
      return cc.toUpperCase();
    })
    .filter((cc) => cc.length > 0);
}
