import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

export async function listPlatformUsers(params: {
  userPoolId: string;
  limit?: number;
  paginationToken?: string;
}) {
  const res = await cognito.send(
    new ListUsersCommand({
      UserPoolId: params.userPoolId,
      Limit: params.limit ?? 60,
      PaginationToken: params.paginationToken,
    })
  );
  return res;
}

export function getAttr(
  attrs: Array<{ Name?: string; Value?: string }> | undefined,
  name: string
): string | undefined {
  const found = (attrs ?? []).find((a) => a.Name === name);
  return found?.Value;
}
