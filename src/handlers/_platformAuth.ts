import type { APIGatewayProxyEventV2 } from 'aws-lambda';

type PlatformAuthContext = {
  tenantIds: string[];
  groups: string[];
  actorSub?: string;
  actorEmail?: string;
  role?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function requirePlatformAuth(event: APIGatewayProxyEventV2): PlatformAuthContext {
  // APIGW JWT authorizer payload shape is not fully typed in aws-lambda defs.
  const rc = event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };

  const claims = rc.authorizer?.jwt?.claims;
  if (!claims || !isRecord(claims)) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }

  const actorSub = typeof claims['sub'] === 'string' ? claims['sub'] : undefined;
  const actorEmail = typeof claims['email'] === 'string' ? claims['email'] : undefined;
  const roleRaw = claims['custom:role'] ?? claims['role'];
  const role = typeof roleRaw === 'string' ? roleRaw : undefined;

  const groupsRaw = claims['cognito:groups'] ?? claims['groups'];
  const groups =
    typeof groupsRaw === 'string'
      ? groupsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const tenantIdsRaw = claims['custom:tenantIds'] ?? claims['tenantIds'];
  const tenantIds =
    typeof tenantIdsRaw === 'string'
      ? tenantIdsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  return { tenantIds, groups, actorSub, actorEmail, role };
}

export function assertTenantAccess(
  tenantId: string,
  ctx: { tenantIds: string[]; groups: string[] }
) {
  if (ctx.groups.includes('SUPER_ADMIN')) return;
  if (!ctx.tenantIds.includes(tenantId)) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  }
}
