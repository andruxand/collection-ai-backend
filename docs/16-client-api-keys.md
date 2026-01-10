# Client API Keys (tenant-scoped)

## What are they?
API keys are used for **machine-to-machine** integrations (client systems → your backend).
Each key is scoped to a tenant and is independent from platform admin login.

## Endpoints (platform JWT required)
- `POST /platform/api-keys/issue`
  - returns the **secret only once**
- `GET /platform/api-keys?tenantId=<id>`
  - returns **keyId, label, status, createdAt, lastUsedAt** (never returns hash/secret)
- `POST /platform/api-keys/disable`

## Client usage
Clients call:
- `POST /client/debtors/upsert`

With headers:
- `X-Tenant-Id: <tenantId>`
- `X-Api-Key: ck_<keyId>_<secret>`

## Security checklist (MVP but production-minded)
- The server stores only a **hash** of the secret (sha256 with pepper).
- Never log the key.
- Send the key to clients via a secure channel:
  - password manager share (recommended)
  - encrypted email (S/MIME/PGP) if available
- Rotate keys:
  - issue a new one
  - disable the old one after client confirms switch
- Consider optional improvements later:
  - IP allowlists per key
  - separate keys per environment (staging/prod)
  - OAuth2 client-credentials / mTLS for higher-security clients
