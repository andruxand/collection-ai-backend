# Demo accounts and keys (MVP)

This repository does not hardcode secrets. Instead, you can **seed** demo users/keys.

## 1) Seed tenant + issue a client API key
```bash
export API_KEY_PEPPER="REPLACE_WITH_RANDOM_LONG_SECRET"
export TABLE_NAME="collections-ai-mvp-dev-core"
export AWS_REGION="us-east-1"

node scripts/seedTenant.js configs/tenant-demo.json --issue-client-key --label "Demo integration"
```

Copy the printed API key (shown once) and test:
- `POST /client/debtors/upsert`
  - headers: `X-Tenant-Id`, `X-Api-Key`

## 2) Invite a demo platform user (operator/admin)
```bash
export PLATFORM_USER_POOL_ID="(from CloudFormation outputs or AWS console)"
export SEED_USER_PASSWORD="StrongPassword123!X"   # optional, simplifies local testing

node scripts/seedTenant.js configs/tenant-demo.json --invite-user admin1@demo.com --role TENANT_ADMIN --tenant-ids tenant-demo
```

## 3) Get a JWT for testing (AWS CLI)
You need:
- `PLATFORM_USER_POOL_CLIENT_ID` (CloudFormation: PlatformUserPoolClient)

Then:
```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$PLATFORM_USER_POOL_CLIENT_ID" \
  --auth-parameters USERNAME=admin1@demo.com,PASSWORD="$SEED_USER_PASSWORD"
```

Use `IdToken` as:
- `Authorization: Bearer <IdToken>`

Test platform endpoints like:
- `GET /platform/tenant?tenantId=tenant-demo`
- `GET /platform/handoffs?tenantId=tenant-demo`
- `POST /platform/api-keys/issue`
