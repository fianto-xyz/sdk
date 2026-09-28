import type { Fianto } from '@fianto/sdk';
import type { Output } from '../output.js';

const LABEL_WIDTH = 13;

function line(label: string, rest: string): string {
  return `${label.padEnd(LABEL_WIDTH)}${rest}`;
}

/** `GET v1/application`: who these credentials belong to and where their webhooks go. */
export async function whoami(client: Fianto, output: Output): Promise<void> {
  const application = await client.application.retrieve();
  output.out(line('Application', `${application.name} (${application.app_id})`));
  output.out(line('Merchant', application.merchant.name));
  output.out(
    application.webhook
      ? line('Webhook', `${application.webhook.status} ${application.webhook.url}`)
      : line('Webhook', 'not configured'),
  );
}
