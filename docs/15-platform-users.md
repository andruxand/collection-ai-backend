# Platform Users (Operators / Tenant Admins)

## Endpoints
All endpoints require platform JWT (Cognito).

- `POST /platform/users/invite`
  ```json
  {
    "tenantId": "tenant-demo",
    "email": "agent1@company.com",
    "role": "OPERATOR",
    "groupsAdd": ["SUPER_ADMIN"]
  }
  ```
  Notes:
  - Tenant admins can only invite to their tenant.
  - Only SUPER_ADMIN can assign multiple tenants or create SUPER_ADMIN users.

- `POST /platform/users/status`
  ```json
  {
    "tenantId": "tenant-demo",
    "email": "agent1@company.com",
    "enabled": false
  }
  ```

## Cognito attributes
- `custom:tenantIds` = CSV of tenant IDs
- `custom:role` = TENANT_ADMIN | OPERATOR | CLIENT_ADMIN | SUPER_ADMIN (role)
- `cognito:groups` can include `SUPER_ADMIN`

## Audit
All invite/update actions are written as `PLATFORM_AUDIT#...` items in DynamoDB.
