# Auth model: API Keys vs JWT (Cognito)

This project intentionally has **two auth surfaces**:

## 1) Client / ingestion API (machine-to-machine)
- Uses **API keys** (e.g. `X-Api-Key`)
- Intended for backend systems to:
  - import debtors
  - post events
  - trigger messages
- Not intended for human login.

## 2) Platform Admin API (human operators)
- Uses **Cognito JWT** via HTTP API JWT authorizer
- Intended for the admin console:
  - configure tenant policy
  - manage handoff cases (assign/close)
  - view operators

### Why not “exchange API key for JWT”?
You could build a token exchange service, but it typically:
- increases attack surface
- complicates auditing and revocation
- mixes machine and human identities

Best practice is to keep:
- API keys for services
- JWT for humans (session, groups, per-user ABAC)

## Future: Client Portal
If you later want each creditor/client to have a UI:
- use a **separate Cognito app client** (or separate user pool) for client users
- issue JWTs and protect `/client/*` UI endpoints with JWT
- keep API keys only for server-to-server integrations
