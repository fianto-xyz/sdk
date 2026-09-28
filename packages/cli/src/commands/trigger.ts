import type { Fianto } from '@fianto/sdk';
import { sampleEvent, signWebhook, WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@fianto/sdk/webhooks';
import { UsageError } from '../config.js';
import type { Deps } from '../main.js';

function isKnownEventType(type: string): type is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * `test.event` with no `--forward-to`: asks fianto to deliver a signed `test.event` to the
 * application's registered webhook endpoint (shares the dashboard's 10/hour budget).
 * Any known type with `--forward-to`: signs a local, realistic sample and POSTs it there —
 * fianto never sends a business-event sample itself (spec §8's safety split).
 */
export async function trigger(
  type: string,
  options: { forwardTo?: string; secret?: string },
  client: Fianto,
  deps: Pick<Deps, 'fetch' | 'output'>,
): Promise<void> {
  if (!isKnownEventType(type)) {
    throw new UsageError(`Unknown event type: ${type}. Known types: ${WEBHOOK_EVENT_TYPES.join(', ')}`);
  }

  if (options.forwardTo) {
    if (!options.secret) throw new UsageError('--secret (or FIANTO_WEBHOOK_SECRET) is required with --forward-to.');
    const { body, headers } = await signWebhook({ event: sampleEvent(type), secret: options.secret });
    const response = await deps.fetch(options.forwardTo, { method: 'POST', headers, body });
    deps.output.out(`→ ${response.status} ${type} (local sample)`);
    return;
  }

  if (type === 'test.event') {
    const result = await client.webhookEndpoint.sendTestEvent();
    deps.output.out(`Sent test.event ${result.event_id} to your registered endpoint`);
    return;
  }

  throw new UsageError(`Only test.event can be sent by fianto. Pass --forward-to <url> to send a local ${type} sample.`);
}
