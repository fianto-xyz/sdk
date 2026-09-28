import type { Fianto } from '@fianto/sdk';
import { sampleEvent, signWebhook, WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@fianto/sdk/webhooks';
import { UsageError } from '../config.js';
import { isLoopbackUrl } from '../loopback.js';
import type { Deps } from '../main.js';

function isKnownEventType(type: string): type is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(type);
}

export interface TriggerOptions {
  forwardTo?: string;
  secret?: string;
  /** True when `secret` was resolved from `FIANTO_WEBHOOK_SECRET` rather than a flag. */
  secretFromEnv?: boolean;
  /** Lets `--forward-to` target a non-loopback URL. Off by default (C5). */
  allowRemote?: boolean;
}

/**
 * `test.event` with no `--forward-to`: asks fianto to deliver a signed `test.event` to the
 * application's registered webhook endpoint (shares the dashboard's 10/hour budget).
 * Any known type with `--forward-to`: signs a local, realistic sample and POSTs it there —
 * fianto never sends a business-event sample itself (spec §8's safety split).
 *
 * `getClient` is called only on the `test.event`-via-API path: a `--forward-to` run makes no
 * API request at all, so it must not require `FIANTO_APP_ID`/`FIANTO_APP_SECRET`/`FIANTO_BASE_URL`
 * to be set (`getClient` is what resolves and validates those, in `main.ts`).
 *
 * `--forward-to` only accepts a loopback URL unless `allowRemote` is set: a signed sample looks
 * exactly like a real delivery, so posting it to an arbitrary public URL could fulfil a real
 * order there (C5). The sample data itself also carries unmistakable ids (`sample_order_…`) for
 * exactly this reason — see `@fianto/sdk/webhooks`' `sampleEvent`.
 */
export async function trigger(
  type: string,
  options: TriggerOptions,
  getClient: () => Fianto,
  deps: Pick<Deps, 'fetch' | 'output'>,
): Promise<void> {
  if (!isKnownEventType(type)) {
    throw new UsageError(`Unknown event type: ${type}. Known types: ${WEBHOOK_EVENT_TYPES.join(', ')}`);
  }

  if (options.forwardTo) {
    if (!/^https?:\/\//.test(options.forwardTo)) {
      throw new UsageError(`--forward-to must be an http:// or https:// URL, got: ${options.forwardTo}`);
    }
    if (!options.allowRemote && !isLoopbackUrl(options.forwardTo)) {
      throw new UsageError(
        `--forward-to must be a loopback URL (localhost, 127.0.0.0/8, [::1]) unless --allow-remote is passed. ` +
          `A signed sample sent to a public URL can be mistaken for a real delivery — got: ${options.forwardTo}`,
      );
    }
    if (!options.secret) throw new UsageError('--secret (or FIANTO_WEBHOOK_SECRET) is required with --forward-to.');
    if (options.secretFromEnv) {
      deps.output.err('Warning: signing with the webhook secret from the environment (FIANTO_WEBHOOK_SECRET).');
    }
    const { body, headers } = await signWebhook({ event: sampleEvent(type), secret: options.secret });
    const response = await deps.fetch(options.forwardTo, { method: 'POST', headers, body });
    deps.output.out(`→ ${response.status} ${type} (local sample)`);
    if (!response.ok) {
      throw new Error(`${options.forwardTo} answered ${response.status} to the local sample.`);
    }
    return;
  }

  if (type === 'test.event') {
    const result = await getClient().webhookEndpoint.sendTestEvent();
    deps.output.out(`Sent test.event ${result.event_id} to your registered endpoint`);
    return;
  }

  throw new UsageError(`Only test.event can be sent by fianto. Pass --forward-to <url> to send a local ${type} sample.`);
}
