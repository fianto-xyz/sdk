// Type-level checks only — no runtime assertions, nothing here executes. See
// `core/errors.test-d.ts` for why this is a `*.test-d.ts` file, not a `*.test.ts`: it is picked
// up by `tsc -p tsconfig.json` (this package's `pnpm typecheck`), not by vitest's runner (its
// `test.include` globs `*.test.ts` only), because what these checks prove — a bad checkout
// params object being REJECTED, a numeric cursor round-tripping into `cursor` — has no runtime
// behaviour to assert; the type itself is the thing under test.
import { expectTypeOf } from 'vitest';
import type { Fianto } from './client.js';
import type { CheckoutSessionCreateParams, FiantoEvent } from './types.js';
import { isEventType } from './webhooks/events.js';

declare const fianto: Fianto;

// --- Item 1 (A1): CheckoutSessionCreateParams is price_id XOR (amount + description) ---------
// The real backend 400s `amount_or_price_required` for an amount checkout with no description
// (every README/example example the audit found did exactly this) — these must be caught here,
// at the type level, instead.

const priceOnly: CheckoutSessionCreateParams = {
  price_id: 'fian_price_1', mode: 'subscription', order_id: 'o-1',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
void priceOnly;

const amountWithDescription: CheckoutSessionCreateParams = {
  amount: '10.00', description: 'Coffee', mode: 'payment', order_id: 'o-1',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
void amountWithDescription;

// @ts-expect-error an amount checkout without `description` must not type-check (A1).
const amountWithoutDescription: CheckoutSessionCreateParams = {
  amount: '10.00', mode: 'payment', order_id: 'o-1',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
void amountWithoutDescription;

// @ts-expect-error price_id and amount are mutually exclusive.
const priceIdAndAmount: CheckoutSessionCreateParams = {
  price_id: 'fian_price_1', amount: '10.00', description: 'Coffee', mode: 'payment', order_id: 'o-1',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
void priceIdAndAmount;

// --- Item 3 (F7/A7): every list's next_cursor round-trips into the next call's cursor ---------
// Before this, `list({ cursor: page.next_cursor })` was a TS error for orders/payments/prices/
// products/subscriptions: their wire `next_cursor` is a number, but `cursor` took only a
// string. The SDK now normalises every `next_cursor` to that same opaque string.

async function cursorRoundTrips(): Promise<void> {
  const orderPage = await fianto.orders.list({ status: 'PAID' });
  expectTypeOf(orderPage.next_cursor).toEqualTypeOf<string | null>();
  if (orderPage.next_cursor !== null) fianto.orders.list({ cursor: orderPage.next_cursor });

  const paymentPage = await fianto.payments.list();
  if (paymentPage.next_cursor !== null) fianto.payments.list({ cursor: paymentPage.next_cursor });

  const pricePage = await fianto.prices.list();
  if (pricePage.next_cursor !== null) fianto.prices.list({ cursor: pricePage.next_cursor });

  const productPage = await fianto.products.list();
  if (productPage.next_cursor !== null) fianto.products.list({ cursor: productPage.next_cursor });

  const subscriptionPage = await fianto.subscriptions.list();
  if (subscriptionPage.next_cursor !== null) fianto.subscriptions.list({ cursor: subscriptionPage.next_cursor });

  // events' own wire cursor was already a string; unaffected, kept here so all six lists are covered.
  const eventPage = await fianto.events.list();
  if (eventPage.next_cursor !== null) fianto.events.list({ cursor: eventPage.next_cursor });
}
void cursorRoundTrips;

// --- Item 4 (F12): events.retrieve returns the typed union; `FiantoEvent` doesn't shadow DOM Event

async function typedEventRetrieve(): Promise<void> {
  const event = await fianto.events.retrieve('evt_x');
  // Pins retrieve()'s return type directly against the exported alias — `isEventType` below is a
  // user-defined type guard, so it narrows on its own signature regardless of `event`'s prior
  // type and would not, by itself, catch `retrieve()` drifting away from `FiantoEvent`.
  expectTypeOf(event).toEqualTypeOf<FiantoEvent>();
  expectTypeOf(event.object).toEqualTypeOf<'event'>();
  // Plain `event.type === 'order.paid'` narrowing doesn't eliminate the `UnknownWebhookEvent`
  // member (its `type` is a bare `string`, which overlaps any literal) — the same reason
  // `webhooks`' own `isEventType` type guard exists; it is the correct way to narrow a
  // `FiantoEvent`, same as a delivered `WebhookEvent | UnknownWebhookEvent`.
  if (isEventType(event, 'order.paid')) {
    expectTypeOf(event.data.order_id).toEqualTypeOf<string>();
  }
}
void typedEventRetrieve;

// The generated schema's own type was named `Event`, shadowing the DOM global for anyone who
// imported it. `FiantoEvent` must not do the same: the bare `Event` identifier below must still
// resolve to `lib.dom.d.ts`'s constructor, not to anything from this package.
const domEvent: Event = new Event('click');
void domEvent;
expectTypeOf<FiantoEvent>().not.toEqualTypeOf<Event>();
