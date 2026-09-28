// Type-level checks only — see `../core/errors.test-d.ts` for why this is a `*.test-d.ts` file
// (compiled by `tsc -p tsconfig.json` under `pnpm typecheck`, never run by vitest).
//
// F1: `switch (event.type)` over what `verifyWebhook` returns must narrow `event.data` with no
// cast. F2: `event.id` must type-check once the URL probe (which has no id) is ruled out.
import { expectTypeOf } from 'vitest';
import {
  isKnownEventType, verifyWebhook,
  type FiantoWebhookEvent, type UnknownWebhookEvent, type WebhookEvent, type WebhookEventType,
} from './index.js';

declare const rawBody: string;
declare const headers: Headers;

export async function narrowsTheVerifiedEvent(): Promise<void> {
  const event = await verifyWebhook(rawBody, headers);
  expectTypeOf(event).toEqualTypeOf<WebhookEvent>();
  switch (event.type) {
    case 'order.paid':
      expectTypeOf(event.data.order_id).toEqualTypeOf<string>();
      expectTypeOf(event.id).toEqualTypeOf<string>();
      break;
    case 'subscription.renewed':
      expectTypeOf(event.data.current_period_index).toEqualTypeOf<number>();
      break;
    case 'endpoint.verification':
      expectTypeOf(event.data.challenge).toEqualTypeOf<string>();
      // @ts-expect-error the URL probe carries no id.
      void event.id;
      break;
    default:
      // Every business event has an id; only the probe (handled above) does not.
      expectTypeOf(event.id).toEqualTypeOf<string>();
  }
}

export async function idAfterRulingOutTheProbe(): Promise<void> {
  const event = await verifyWebhook(rawBody, headers);
  if (event.type === 'endpoint.verification') return;
  expectTypeOf(event).toEqualTypeOf<FiantoWebhookEvent>();
  expectTypeOf(event.id).toEqualTypeOf<string>();
}

declare const type: string;
if (isKnownEventType(type)) {
  expectTypeOf(type).toEqualTypeOf<WebhookEventType>();
}

// Kept for defensive code that handles types newer than this SDK.
declare const unknownEvent: UnknownWebhookEvent;
expectTypeOf(unknownEvent.data).toEqualTypeOf<unknown>();
