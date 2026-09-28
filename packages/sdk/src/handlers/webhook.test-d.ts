// Type-level checks only — see `../core/errors.test-d.ts` for why this is a `*.test-d.ts` file
// (compiled by `tsc -p tsconfig.json` under `pnpm typecheck`, never run by vitest).
//
// F1/F2: `onEvent` and `onError` receive business events only (the handler answers the URL
// probe itself), so `switch (event.type)` narrows `event.data` and `event.id` is a string.
import { expectTypeOf } from 'vitest';
import type { FiantoWebhookEvent } from '../webhooks/events.js';
import { createWebhookHandler } from './webhook.js';

createWebhookHandler({
  onEvent: (event) => {
    expectTypeOf(event).toEqualTypeOf<FiantoWebhookEvent>();
    expectTypeOf(event.id).toEqualTypeOf<string>();
    switch (event.type) {
      case 'order.paid':
        expectTypeOf(event.data.order_id).toEqualTypeOf<string>();
        break;
      case 'checkout.session.completed':
        expectTypeOf(event.data.mode).toEqualTypeOf<'payment' | 'subscription'>();
        break;
      // @ts-expect-error the URL probe never reaches onEvent.
      case 'endpoint.verification':
        break;
      default:
        break;
    }
  },
  onError: (error, event) => {
    expectTypeOf(error).toEqualTypeOf<unknown>();
    expectTypeOf(event.id).toEqualTypeOf<string>();
    if (event.type === 'subscription.past_due') {
      expectTypeOf(event.data.status).toEqualTypeOf<'ACTIVE' | 'PAST_DUE' | 'ENDED'>();
    }
  },
});
