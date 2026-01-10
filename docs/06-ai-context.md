# AI Context (read me first)

If you are an IDE agent, read these in order:

1) `docs/30-frontend-guide.md`
2) `docs/31-api-contracts.md`
3) `docs/14-auth-model.md`
4) `docs/20-demo-accounts.md`
5) `docs/07-tenant-config.md`
6) `docs/18-country-policy.md`

Then consult backend specifics if needed:
- `docs/09-handoff.md`
- `docs/11-email-notifications.md`
- `docs/15-platform-users.md`
- `docs/16-client-api-keys.md`
- `docs/19-audit.md`


## Country policies (DynamoDB)
- Country baseline policies are stored in the same DynamoDB table using keys: `COUNTRY#<CC>` / `POLICY`.
- Runtime merges tenant policy + country policy via `buildEffectivePolicy()`.
- Seed policies using `npm run seed:country-policies`.
