# Email Notifications (SES)

## Purpose
Notify operations when:
- a handoff case is created (from automated conversation)
- a case is assigned to a specific operator (optional)

## How it works
- When a handoff is triggered, a HANDOFF case is persisted in DynamoDB.
- An event is also sent to SQS (if configured).
- `handoffNotifier` Lambda consumes SQS messages and sends an email via AWS SES.

## Tenant config
`policy.notificationPolicy.email` controls:
- `enabled`
- `fromAddress` (must be SES verified)
- `toAddresses` (ops queue)
- `subjectPrefix`
- `includeInboundText`

## SES notes (MVP)
- In sandbox mode SES can only send to verified addresses.
- In production, move SES out of sandbox and verify domain/sender.

## Troubleshooting
- Missing emails: check CloudWatch logs for `handoffNotifier`
- AccessDenied: ensure IAM has `ses:SendEmail`
- Wrong recipients: verify tenant policy record in Dynamo (`TENANT#<id> / META`)
