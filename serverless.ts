const service = 'collections-ai-mvp';

// Use a loose cast because Serverless's TS definitions are strict about
// CloudFormation intrinsics and template expressions used here.
const config = {
  service,
  frameworkVersion: '3',
  useDotenv: true,
  plugins: ['serverless-esbuild'],
  package: {
    patterns: ['src/core/conversation/prompts/**', 'src/core/policy/curated/data/**'],
  },
  provider: {
    name: 'aws',
    profile: 'adrian-personal',
    runtime: 'nodejs22.x',
    versionFunctions: false,
    region: "${opt:region, 'us-east-1'}",
    stage: "${opt:stage, 'dev'}",
    deploymentBucket: {
      // Bucket único para artefactos de despliegue de Serverless
      name: '${self:service}-${aws:region}-deployments',
      serverSideEncryption: 'AES256',
    },
    logRetentionInDays: 14,
    httpApi: {
      cors: true,
      authorizers: {
        platformJwt: {
          type: 'jwt',
          identitySource: '$request.header.Authorization',
          issuerUrl: { 'Fn::GetAtt': ['PlatformUserPool', 'ProviderURL'] } as any,
          audience: [{ Ref: 'PlatformUserPoolClient' }] as any,
        },
      },
    },
    environment: {
      STAGE: '${self:provider.stage}',
      PLATFORM_USER_POOL_ID: { Ref: 'PlatformUserPool' } as any,
      IDEMPOTENCY_TTL_SECONDS: "${env:IDEMPOTENCY_TTL_SECONDS, '604800'}",
      OUTBOUND_TICK_DEBTOR_LIMIT: "${env:OUTBOUND_TICK_DEBTOR_LIMIT, '50'}",
      OUTBOUND_TICK_TENANT_LIMIT: "${env:OUTBOUND_TICK_TENANT_LIMIT, '25'}",
      PLATFORM_AUDIT_RETENTION_DAYS: "${env:PLATFORM_AUDIT_RETENTION_DAYS, '180'}",
      POWERTOOLS_SERVICE_NAME: service,
      POWERTOOLS_LOG_LEVEL: 'INFO',
      TABLE_NAME: '${self:service}-${self:provider.stage}-core',
      INBOUND_QUEUE_URL: { Ref: 'InboundQueue' } as any,
      INBOUND_QUEUE_ARN: { 'Fn::GetAtt': ['InboundQueue', 'Arn'] } as any,

      // Conversation orchestration toggles (runtime)
      CONVERSATION_MULTI_AGENT_ENABLED: "${env:CONVERSATION_MULTI_AGENT_ENABLED, 'true'}",
      CONVERSATION_CONTEXT_PACK_V1_ENABLED: "${env:CONVERSATION_CONTEXT_PACK_V1_ENABLED, 'true'}",
      CONV_V2_ENABLED: "${env:CONV_V2_ENABLED, 'true'}",
      DIALOGUE_MANAGER_ENABLED: "${env:DIALOGUE_MANAGER_ENABLED, 'false'}",
      DEBUG_CONVERSATION_PATH: "${env:DEBUG_CONVERSATION_PATH, 'false'}",

      // Whasapp webhook secrets
      // META_VERIFY_TOKEN: '${ssm:/${self:service}/${self:provider.stage}/metaVerifyToken}',
      // META_APP_SECRET_ARN: '${ssm:/${self:service}/${self:provider.stage}/metaAppSecretArn}',

      // Telegram webhook secret
      TELEGRAM_WEBHOOK_SECRET_TOKEN:
        '${ssm:/${self:service}/${self:provider.stage}/telegramWebhookSecretToken}',

      ADMIN_API_KEY: '${ssm:/${self:service}/${self:provider.stage}/adminApiKey}',
      API_KEY_PEPPER: '${ssm:/${self:service}/${self:provider.stage}/apiKeyPepper}',
      TENANT_DEFAULT_ID: 'tenant-demo',
      HANDOFF_QUEUE_URL: { Ref: 'HandoffQueue' } as any,

      // Optional:
      LLM_PROVIDER_JSON:
        '${env:LLM_PROVIDER_JSON, \'{"provider":"openai","model":"gpt-4o-mini"}\'}',
      LLM_OPENAI_KEY_SECRET_ID: '${env:LLM_OPENAI_KEY_SECRET_ID, ""}',
    },
    iam: {
      role: {
        statements: [
          {
            Effect: 'Allow',
            Action: [
              'sqs:SendMessage',
              'sqs:ReceiveMessage',
              'sqs:DeleteMessage',
              'sqs:GetQueueAttributes',
            ],
            Resource: [
              { 'Fn::GetAtt': ['InboundQueue', 'Arn'] },
              { 'Fn::GetAtt': ['HandoffQueue', 'Arn'] },
            ],
          },
          {
            Effect: 'Allow',
            Action: [
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:Query',
            ],
            Resource: [
              { 'Fn::GetAtt': ['CoreTable', 'Arn'] },
              { 'Fn::Join': ['', [{ 'Fn::GetAtt': ['CoreTable', 'Arn'] }, '/index/*']] },
            ],
          },
          {
            Effect: 'Allow',
            Action: ['sqs:SendMessage'],
            Resource: [{ 'Fn::GetAtt': ['HandoffQueue', 'Arn'] }],
          },
          {
            Effect: 'Allow',
            Action: ['s3:PutObject'],
            Resource: 'arn:aws:s3:::*/*',
          },
          {
            Effect: 'Allow',
            Action: [
              'cognito-idp:ListUsers',
              'cognito-idp:AdminCreateUser',
              'cognito-idp:AdminDisableUser',
              'cognito-idp:AdminEnableUser',
              'cognito-idp:AdminUpdateUserAttributes',
              'cognito-idp:AdminAddUserToGroup',
              'cognito-idp:AdminRemoveUserFromGroup',
            ],
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: ['ses:SendEmail', 'ses:SendRawEmail'],
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: ['secretsmanager:GetSecretValue'],
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: ['s3:ListBucket'],
            Resource: 'arn:aws:s3:::collections-ai-mvp-293262438125-us-east-1-deployments',
          },
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:PutObject'],
            Resource: 'arn:aws:s3:::collections-ai-mvp-293262438125-us-east-1-deployments/*',
          },
        ],
      },
    },
  },
  functions: {
    whatsappWebhook: {
      handler: 'src/handlers/whatsappWebhook.handler',
      events: [{ httpApi: { path: '/webhooks/whatsapp', method: 'any' } }],
      timeout: 15,
    },
    telegramWebhook: {
      handler: 'src/handlers/telegramWebhook.handler',
      events: [{ httpApi: { path: '/webhooks/telegram/{botKey}', method: 'post' } }],
      timeout: 15,
    },
    orchestrator: {
      handler: 'src/handlers/orchestrator.handler',
      events: [
        {
          sqs: {
            arn: { 'Fn::GetAtt': ['InboundQueue', 'Arn'] },
            batchSize: 1,
          },
        },
      ],
      timeout: 60,
    },
    adminUpsertTenant: {
      handler: 'src/handlers/adminUpsertTenant.handler',
      events: [{ httpApi: { path: '/admin/tenant', method: 'post' } }],
      timeout: 20,
    },
    adminListHandoffs: {
      handler: 'src/handlers/adminListHandoffs.handler',
      events: [{ httpApi: { path: '/admin/handoffs', method: 'get' } }],
      timeout: 20,
    },
    adminCloseHandoff: {
      handler: 'src/handlers/adminCloseHandoff.handler',
      events: [{ httpApi: { path: '/admin/handoffs/close', method: 'post' } }],
      timeout: 20,
    },

    // Platform (admin UI) endpoints - Cognito JWT protected
    platformListHandoffs: {
      handler: 'src/handlers/platformListHandoffs.handler',
      events: [
        {
          httpApi: {
            path: '/platform/handoffs',
            method: 'get',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },

    platformHandoffDetail: {
      handler: 'src/handlers/platformHandoffDetail.handler',
      events: [
        {
          httpApi: {
            path: '/platform/handoffs/detail',
            method: 'get',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },
    platformListOperators: {
      handler: 'src/handlers/platformListOperators.handler',
      events: [
        {
          httpApi: {
            path: '/platform/operators',
            method: 'get',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },

    platformInviteUser: {
      handler: 'src/handlers/platformInviteUser.handler',
      events: [
        {
          httpApi: {
            path: '/platform/users/invite',
            method: 'post',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },
    platformSetUserStatus: {
      handler: 'src/handlers/platformSetUserStatus.handler',
      events: [
        {
          httpApi: {
            path: '/platform/users/status',
            method: 'post',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },
    platformIssueClientApiKey: {
      handler: 'src/handlers/platformIssueClientApiKey.handler',
      events: [
        {
          httpApi: {
            path: '/platform/api-keys/issue',
            method: 'post',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },
    platformListClientApiKeys: {
      handler: 'src/handlers/platformListClientApiKeys.handler',
      events: [
        {
          httpApi: {
            path: '/platform/api-keys',
            method: 'get',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },
    platformDisableClientApiKey: {
      handler: 'src/handlers/platformDisableClientApiKey.handler',
      events: [
        {
          httpApi: {
            path: '/platform/api-keys/disable',
            method: 'post',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },

    platformListAudit: {
      handler: 'src/handlers/platformListAudit.handler',
      events: [
        {
          httpApi: { path: '/platform/audit', method: 'get', authorizer: { name: 'platformJwt' } },
        },
      ],
      timeout: 20,
    },

    // Client integration (API key) endpoints
    clientUpsertDebtors: {
      handler: 'src/handlers/clientUpsertDebtors.handler',
      events: [{ httpApi: { path: '/client/debtors/upsert', method: 'post' } }],
      timeout: 20,
    },

    clientConversationStatus: {
      handler: 'src/handlers/clientConversationStatus.handler',
      events: [{ httpApi: { path: '/client/conversations/status', method: 'get' } }],
      timeout: 20,
    },

    clientCreateTelegramEnrollmentCode: {
      handler: 'src/handlers/clientCreateTelegramEnrollmentCode.handler',
      events: [{ httpApi: { path: '/client/debtors/telegram-enrollment-code', method: 'post' } }],
      timeout: 20,
    },

    clientCloseDebtorCase: {
      handler: 'src/handlers/clientCloseDebtorCase.handler',
      events: [{ httpApi: { path: '/client/debtors/close', method: 'post' } }],
      timeout: 20,
    },

    platformAssignHandoff: {
      handler: 'src/handlers/platformAssignHandoff.handler',
      events: [
        {
          httpApi: {
            path: '/platform/handoffs/assign',
            method: 'post',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },
    platformGetTenant: {
      handler: 'src/handlers/platformGetTenant.handler',
      events: [
        {
          httpApi: { path: '/platform/tenant', method: 'get', authorizer: { name: 'platformJwt' } },
        },
      ],
      timeout: 20,
    },
    platformListTenants: {
      handler: 'src/handlers/platformListTenants.handler',
      events: [
        {
          httpApi: {
            path: '/platform/tenants',
            method: 'get',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },
    platformUpsertTenant: {
      handler: 'src/handlers/platformUpsertTenant.handler',
      events: [
        {
          httpApi: {
            path: '/platform/tenant',
            method: 'post',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },

    platformListCuratedPolicyVersions: {
      handler: 'src/handlers/platformListCuratedPolicyVersions.handler',
      events: [
        {
          httpApi: {
            path: '/platform/curated-policy/versions',
            method: 'get',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },

    platformCloseHandoff: {
      handler: 'src/handlers/platformCloseHandoff.handler',
      events: [
        {
          httpApi: {
            path: '/platform/handoffs/close',
            method: 'post',
            authorizer: { name: 'platformJwt' },
          },
        },
      ],
      timeout: 20,
    },

    // Worker that sends email notifications for handoff events
    handoffNotifier: {
      handler: 'src/handlers/handoffNotifier.handler',
      events: [{ sqs: { arn: { 'Fn::GetAtt': ['HandoffQueue', 'Arn'] } } }],
      timeout: 60,
    },
    adminExportAudit: {
      handler: 'src/handlers/adminExportAudit.handler',
      events: [{ httpApi: { path: '/admin/export/audit', method: 'post' } }],
      timeout: 60,
    },
    adminUpsertDebtors: {
      handler: 'src/handlers/adminUpsertDebtors.handler',
      events: [{ httpApi: { path: '/admin/debtors', method: 'post' } }],
      timeout: 20,
    },
    remindersTick: {
      handler: 'src/handlers/remindersTick.handler',
      events: [{ schedule: 'rate(5 minutes)' }],
      timeout: 30,
    },
    outboundTick: {
      handler: 'src/handlers/outboundTick.handler',
      events: [{ schedule: 'rate(15 minutes)' }],
      timeout: 60,
    },
  },
  custom: {
    esbuild: {
      bundle: true,
      minify: false,
      sourcemap: true,
      exclude: ['aws-sdk'],
      tsconfig: 'tsconfig.json',
      tsconfigPaths: true,
    },
  },
  resources: {
    Resources: {
      PlatformUserPool: {
        Type: 'AWS::Cognito::UserPool',
        Properties: {
          UserPoolName: '${self:service}-${self:provider.stage}-platform',
          UsernameAttributes: ['email'],
          AutoVerifiedAttributes: ['email'],
          Schema: [
            { Name: 'tenantIds', AttributeDataType: 'String', Mutable: true },
            { Name: 'role', AttributeDataType: 'String', Mutable: true },
          ],
        },
      },
      PlatformUserPoolClient: {
        Type: 'AWS::Cognito::UserPoolClient',
        Properties: {
          ClientName: '${self:service}-${self:provider.stage}-platform-client',
          UserPoolId: { Ref: 'PlatformUserPool' },
          GenerateSecret: false,
          ExplicitAuthFlows: [
            'ALLOW_USER_SRP_AUTH',
            'ALLOW_USER_PASSWORD_AUTH',
            'ALLOW_REFRESH_TOKEN_AUTH',
          ],
        },
      },
      InboundQueue: {
        Type: 'AWS::SQS::Queue',
        Properties: {
          QueueName: '${self:service}-${self:provider.stage}-inbound.fifo',
          FifoQueue: true,
          ContentBasedDeduplication: true,
          VisibilityTimeout: 60,
          MessageRetentionPeriod: 345600,
        },
      },
      HandoffQueue: {
        Type: 'AWS::SQS::Queue',
        Properties: {
          QueueName: '${self:service}-${self:provider.stage}-handoff.fifo',
          FifoQueue: true,
          ContentBasedDeduplication: true,
          VisibilityTimeout: 60,
          MessageRetentionPeriod: 345600,
        },
      },
      CoreTable: {
        Type: 'AWS::DynamoDB::Table',
        Properties: {
          TableName: '${self:service}-${self:provider.stage}-core',
          BillingMode: 'PAY_PER_REQUEST',
          SSESpecification: { SSEEnabled: true },
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
            { AttributeName: 'gsi1pk', AttributeType: 'S' },
            { AttributeName: 'gsi1sk', AttributeType: 'S' },
          ],
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'gsi1',
              KeySchema: [
                { AttributeName: 'gsi1pk', KeyType: 'HASH' },
                { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          ],
          TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
        },
      },
    },
  },
};

module.exports = config;
