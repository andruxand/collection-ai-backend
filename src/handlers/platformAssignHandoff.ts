import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { toHttpError } from '../core/errors';
import { sendOpsEmail } from '../core/notifications/email';
import { putPlatformAudit } from '../core/store/platformAudit';
import { getHandoffCase, getTenant, putHandoffEvent, updateHandoffCase } from '../core/store/repos';
import { assertTenantAccess, requirePlatformAuth } from './_platformAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const BodySchema = z.object({
  tenantId: z.string().min(3),
  caseSk: z.string().min(10),
  assignedToEmail: z.string().email().optional(),
  assignedToUserSub: z.string().min(10).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  tags: z.array(z.string().min(1).max(30)).max(20).optional(),
});

function ttlSeconds(days?: number): number | undefined {
  if (!days || days <= 0) return undefined;
  return Math.floor(Date.now() / 1000) + days * 86400;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requirePlatformAuth(event);

    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid body', errors: parsed.error.flatten() }),
      };
    }

    assertTenantAccess(parsed.data.tenantId, ctx);

    await updateHandoffCase({
      tenantId: parsed.data.tenantId,
      caseSk: parsed.data.caseSk,
      patch: {
        assignedToEmail: parsed.data.assignedToEmail ?? undefined,
        assignedToUserSub: parsed.data.assignedToUserSub ?? undefined,
        priority: parsed.data.priority ?? undefined,
        tags: parsed.data.tags ?? undefined,
      },
    });

    const item = await getHandoffCase({
      tenantId: parsed.data.tenantId,
      caseSk: parsed.data.caseSk,
    });
    if (!item) {
      return { statusCode: 404, body: JSON.stringify({ message: 'Handoff case not found' }) };
    }

    const tenant = await getTenant(parsed.data.tenantId);
    const emailCfg = tenant.policy.notificationPolicy.email;

    // Notify assignee (optional)
    if (emailCfg.enabled && parsed.data.assignedToEmail) {
      const subject = `${emailCfg.subjectPrefix} Case assigned | ${item.intent} | ${item.stage}`;
      const bodyLines = [
        `Tenant: ${parsed.data.tenantId}`,
        `CaseId: ${item.caseId}`,
        `Status: ${item.status}`,
        `AssignedTo: ${parsed.data.assignedToEmail}`,
        `Priority: ${item.priority ?? ''}`,
        `Tags: ${(item.tags ?? []).join(', ')}`,
        '',
        `Inbound: ${emailCfg.includeInboundText ? item.inboundText ?? '' : '(disabled)'}`,
        '',
        'Next steps: open the platform to handle the case.',
      ].join('\n');

      await sendOpsEmail({
        tenant,
        to: [parsed.data.assignedToEmail],
        subject,
        textBody: bodyLines,
      });
      await putHandoffEvent({
        tenantId: parsed.data.tenantId,
        caseId: item.caseId,
        caseSk: parsed.data.caseSk,
        type: 'EMAIL_SENT',
        payload: { to: [parsed.data.assignedToEmail], subject, kind: 'ASSIGN' },
        ttl: ttlSeconds(tenant.policy.handoffPolicy.retentionDays),
      });
    }

    await putHandoffEvent({
      tenantId: parsed.data.tenantId,
      caseId: item.caseId,
      caseSk: parsed.data.caseSk,
      type: 'ASSIGNED',
      payload: {
        assignedToEmail: parsed.data.assignedToEmail,
        assignedToUserSub: parsed.data.assignedToUserSub,
        priority: parsed.data.priority,
        tags: parsed.data.tags,
      },
      ttl: ttlSeconds(tenant.policy.handoffPolicy.retentionDays),
    });

    await putPlatformAudit({
      tenantId: parsed.data.tenantId,
      actorSub: ctx.actorSub,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.role,
      action: 'HANDOFF_ASSIGN',
      resource: `handoff:${parsed.data.caseSk}`,
      payload: {
        assignedToEmail: parsed.data.assignedToEmail,
        assignedToUserSub: parsed.data.assignedToUserSub,
        priority: parsed.data.priority,
        tags: parsed.data.tags,
      },
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err: unknown) {
    const httpErr = toHttpError(err);
    logger.error('platformAssignHandoff error', { err: httpErr });
    return {
      statusCode: httpErr.statusCode,
      body: JSON.stringify({
        message: httpErr.statusCode === 500 ? 'Internal error' : httpErr.message,
      }),
    };
  }
};
