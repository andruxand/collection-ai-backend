import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';

import type { Tenant } from '../types';

const ses = new SESClient({});

export async function sendOpsEmail(params: {
  tenant: Tenant;
  to: string[];
  subject: string;
  textBody: string;
}) {
  const from = params.tenant.policy.notificationPolicy.email.fromAddress;

  await ses.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: params.to },
      Message: {
        Subject: { Data: params.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: params.textBody, Charset: 'UTF-8' },
        },
      },
    })
  );
}
