# Handoff Detail + Operators (Platform)

## Handoff detail
Endpoint:
- `GET /platform/handoffs/detail?tenantId=<id>&caseSk=<HANDOFF#...>&eventsLimit=100`

Returns:
- the case item
- case events (`HANDOFF_EVENT#...`)

## Operators
Operators are platform users (Cognito) who have access to a tenant.

Endpoint:
- `GET /platform/operators?tenantId=<id>`

Returns a list of users filtered by:
- SUPER_ADMIN group OR
- user attribute contains that tenantId

### Attributes
We use these custom attributes in Cognito:
- `custom:tenantIds` (CSV)
- `custom:role` (TENANT_ADMIN / OPERATOR / etc.)

In MVP you can manage users in AWS console.
