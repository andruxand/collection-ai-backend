/**
 * Seed (upsert) tenant META record into DynamoDB without a frontend.
 *
 * Usage:
 *   TABLE_NAME=collections-ai-mvp-dev-core AWS_REGION=us-east-1 node scripts/seedTenant.js configs/tenant-demo.json
 *
 * Issue a client API key (printed ONCE) and store only hash:
 *   API_KEY_PEPPER=... TABLE_NAME=... AWS_REGION=... node scripts/seedTenant.js configs/tenant-demo.json --issue-client-key --label "Prod integration"
 *
 * Optionally create platform users (and set a permanent password if SEED_USER_PASSWORD is set):
 *   PLATFORM_USER_POOL_ID=... node scripts/seedTenant.js configs/tenant-demo.json --invite-user ops1@company.com --role OPERATOR --tenant-ids tenant-demo
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getTableName } = require('./config');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminSetUserPasswordCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

function base64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function generateClientApiKey() {
  const keyId = base64Url(crypto.randomBytes(8));
  const secret = base64Url(crypto.randomBytes(32));
  return { apiKey: `ck_${keyId}_${secret}`, keyId, secret };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) args._.push(a);
    else {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

async function inviteUser({ userPoolId, email, role, tenantIds, groups }) {
  const cognito = new CognitoIdentityProviderClient({});
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenantIds', Value: tenantIds.join(',') },
        { Name: 'custom:role', Value: role },
      ],
    })
  );
  if (process.env.SEED_USER_PASSWORD) {
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: email,
        Password: process.env.SEED_USER_PASSWORD,
        Permanent: true,
      })
    );
  }
  for (const g of groups || []) {
    await cognito.send(
      new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: email, GroupName: g })
    );
  }
}

(async () => {
  const args = parseArgs(process.argv);
  const file = args._[0];
  if (!file) {
    console.error(
      'Usage: node scripts/seedTenant.js <path-to-tenant-json> [--issue-client-key] [--invite-user email]'
    );
    process.exit(1);
  }

  const tableName = getTableName();

  const jsonPath = path.resolve(process.cwd(), file);
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const tenant = JSON.parse(raw);

  // Ensure tenant record format
  if (!tenant.tenantId || !tenant.name || !tenant.policy) {
    throw new Error('Invalid tenant json: required fields tenantId, name, policy');
  }

  tenant.clientAuth = tenant.clientAuth || { apiKeys: [] };

  if (args['issue-client-key']) {
    const pepper = process.env.API_KEY_PEPPER;
    if (!pepper) throw new Error('Missing API_KEY_PEPPER env var');
    const label = args.label && args.label !== true ? String(args.label) : undefined;

    const { apiKey, keyId, secret } = generateClientApiKey();
    const hash = sha256Hex(`${pepper}:${secret}`);

    tenant.clientAuth.apiKeys.push({
      keyId,
      label,
      status: 'ACTIVE',
      createdAtIso: new Date().toISOString(),
      hash,
    });

    console.log('\n=== CLIENT API KEY (SHOW ONCE) ===');
    console.log(apiKey);
    console.log('keyId:', keyId);
    console.log('=================================\n');
  }

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const pk = `TENANT#${tenant.tenantId}`;

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: { pk, sk: 'META', ...tenant },
    })
  );

  console.log(`Seeded tenant META: ${tenant.tenantId} -> ${tableName}`);

  if (args['invite-user']) {
    const userPoolId = process.env.PLATFORM_USER_POOL_ID;
    if (!userPoolId) throw new Error('Missing PLATFORM_USER_POOL_ID env var');
    const email = String(args['invite-user']);
    const role = String(args.role || 'OPERATOR');
    const tenantIds = String(args['tenant-ids'] || tenant.tenantId)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const groups = args.groups
      ? String(args.groups)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    await inviteUser({ userPoolId, email, role, tenantIds, groups });

    console.log(`Invited platform user: ${email} role=${role} tenants=${tenantIds.join(',')}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
