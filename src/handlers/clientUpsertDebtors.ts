import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { upsertDebtors } from '../core/store/repos';
import { requireClientAuth } from './_clientAuth';

const logger = new Logger({ serviceName: 'collections-ai-mvp' });

const DebtorSchema = z
  .object({
    debtorId: z.string().optional(),
    phoneE164: z
      .string()
      .regex(/^\+\d{7,15}$/)
      .optional(),
    telegramUserId: z.string().optional(),
    totalDueCop: z.number().int().nonnegative(),
    daysPastDue: z.number().int().nonnegative(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    stage: z.enum(['EARLY', 'MID', 'LATE']).optional(),
    consents: z
      .object({
        whatsapp: z.boolean().optional(),
        telegram: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((x) => x.debtorId || x.phoneE164 || x.telegramUserId, {
    message: 'Provide debtorId or phoneE164 or telegramUserId',
  });

const BodySchema = z.object({
  // tenantId is derived from x-tenant-id header for client API
  tenantId: z.never().optional(),
  debtors: z.array(DebtorSchema).min(1),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = await requireClientAuth(event);

    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid body', errors: parsed.error.flatten() }),
      };
    }

    const tenantId = auth.tenantId;
    await upsertDebtors({ tenantId, debtors: parsed.data.debtors });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, count: parsed.data.debtors.length }),
    };
  } catch (err: unknown) {
    logger.error('adminUpsertDebtors error', { err });
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal error' }) };
  }
};
