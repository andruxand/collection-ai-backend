import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

export async function invitePlatformUser(params: {
  userPoolId: string;
  email: string;
  tenantIdsCsv: string;
  role: string;
  groups?: string[];
}) {
  // Create user (Cognito sends invitation email by default)
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: params.userPoolId,
      Username: params.email,
      UserAttributes: [
        { Name: 'email', Value: params.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenantIds', Value: params.tenantIdsCsv },
        { Name: 'custom:role', Value: params.role },
      ],
    })
  );

  for (const g of params.groups ?? []) {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: params.userPoolId,
        Username: params.email,
        GroupName: g,
      })
    );
  }
}

export async function disablePlatformUser(params: { userPoolId: string; email: string }) {
  await cognito.send(
    new AdminDisableUserCommand({ UserPoolId: params.userPoolId, Username: params.email })
  );
}

export async function enablePlatformUser(params: { userPoolId: string; email: string }) {
  await cognito.send(
    new AdminEnableUserCommand({ UserPoolId: params.userPoolId, Username: params.email })
  );
}

export async function updatePlatformUser(params: {
  userPoolId: string;
  email: string;
  tenantIdsCsv?: string;
  role?: string;
}) {
  const attrs = [];
  if (params.tenantIdsCsv !== undefined)
    attrs.push({ Name: 'custom:tenantIds', Value: params.tenantIdsCsv });
  if (params.role !== undefined) attrs.push({ Name: 'custom:role', Value: params.role });
  if (!attrs.length) return;

  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: params.userPoolId,
      Username: params.email,
      UserAttributes: attrs,
    })
  );
}

export async function addUserToGroup(params: { userPoolId: string; email: string; group: string }) {
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: params.userPoolId,
      Username: params.email,
      GroupName: params.group,
    })
  );
}
export async function removeUserFromGroup(params: {
  userPoolId: string;
  email: string;
  group: string;
}) {
  await cognito.send(
    new AdminRemoveUserFromGroupCommand({
      UserPoolId: params.userPoolId,
      Username: params.email,
      GroupName: params.group,
    })
  );
}
