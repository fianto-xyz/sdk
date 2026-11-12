// Type-level checks only — no runtime assertions, nothing here executes. See
// `core/errors.test-d.ts` for why this is a `*.test-d.ts` file, not a `*.test.ts`: it is picked
// up by `tsc -p tsconfig.json` (this package's `pnpm typecheck`), not by vitest's runner (its
// `test.include` globs `*.test.ts` only), because what these checks prove — a bad checkout
// params object being REJECTED, a numeric cursor round-tripping into `cursor` — has no runtime
// behaviour to assert; the type itself is the thing under test.
import { expectTypeOf } from 'vitest';
import type { Fianto } from './client.js';
import type {
  CardPayment, CardSubscription, CheckoutSession, CheckoutSessionCreateParams, CryptoPayment, CryptoSubscription, FiantoEvent,
  Order, OrderPayment, PaidSessionPayment, Payment, PaymentCard, PaymentMethod, Subscription,
} from './types.js';
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
// imported it. Proving `FiantoEvent` merely differs in shape from `Event` (a structural
// inequality check) is weak — nothing stops a FUTURE type also named `Event` from being added
// and re-creating the exact shadowing bug. The real fix is that the package's public entry has
// no `Event` export at all any more: prove that directly.
// @ts-expect-error 'Event' is not an exported member of './index.js' — F12 renamed it to
// FiantoEvent specifically so it stops shadowing the DOM global.
type _EventIsNotExported = import('./index.js').Event;

// --- Renewal network fee (October 2026): always present on v1 reads ("0" where none) ---------
// total_amount = amount + fee_amount + network_fee_amount on sessions, orders, payments and subscriptions.
expectTypeOf<CheckoutSession['network_fee_amount']>().toEqualTypeOf<string>();
expectTypeOf<Order['network_fee_amount']>().toEqualTypeOf<string>();
expectTypeOf<Payment['network_fee_amount']>().toEqualTypeOf<string>();
expectTypeOf<Subscription['network_fee_amount']>().toEqualTypeOf<string>();

// --- Card payments (Stripe Plan 6): each rail is its own branch, discriminated by `method` -----
// Only what the spec guarantees per rail is narrowed (Payment_gateway_chain: a crypto payment
// always has its chain row; a card payment never has one).

declare const payment: Payment;
declare const order: Order;
declare const session: CheckoutSession;
declare const subscription: Subscription;

// "keeps signature a string on the crypto branch"
if (payment.method === 'crypto') {
  expectTypeOf(payment).toEqualTypeOf<CryptoPayment>();
  expectTypeOf(payment.gateway).toEqualTypeOf<'solana'>();
  expectTypeOf(payment.signature).toEqualTypeOf<string>();
  expectTypeOf(payment.slot).toEqualTypeOf<string | null>();
  expectTypeOf(payment.block_time).toEqualTypeOf<string | null>();
  expectTypeOf(payment.card).toEqualTypeOf<null>();
  // A crypto payer's wallet stays nullable, as the spec types it (R1 row 3, OQ2).
  expectTypeOf(payment.customer.wallet).toEqualTypeOf<string | null>();
}
// Narrowing on `gateway` works the same way.
if (payment.gateway === 'solana') expectTypeOf(payment.signature).toEqualTypeOf<string>();

// "makes signature null and card nullable on the card branch"
if (payment.method === 'card') {
  expectTypeOf(payment).toEqualTypeOf<CardPayment>();
  expectTypeOf(payment.gateway).toEqualTypeOf<'stripe'>();
  expectTypeOf(payment.signature).toEqualTypeOf<null>();
  expectTypeOf(payment.slot).toEqualTypeOf<null>();
  expectTypeOf(payment.block_time).toEqualTypeOf<null>();
  expectTypeOf(payment.card).toEqualTypeOf<PaymentCard | null>();
  expectTypeOf(payment.card?.last4).toEqualTypeOf<string | null | undefined>();
  expectTypeOf(payment.card?.brand).toEqualTypeOf<string | null | undefined>();
  // A card payer has no wallet, as on CardSubscription.
  expectTypeOf(payment.customer.wallet).toEqualTypeOf<null>();
}
// Without a method check the signature stays `string | null`, as it was on 0.6.0; after a
// `method === 'crypto'` check it is now `string` (above), which is the gain (Review Focus 1).
// @ts-expect-error signature is null on the card branch
const unnarrowedSignature: string = payment.signature;
void unnarrowedSignature;
expectTypeOf(payment.method).toEqualTypeOf<PaymentMethod>();

// "narrows currency per branch"
expectTypeOf(payment.currency).toEqualTypeOf<'USDC' | 'USD'>();
if (payment.method === 'crypto') expectTypeOf(payment.currency).toEqualTypeOf<'USDC'>();
if (payment.method === 'card') expectTypeOf(payment.currency).toEqualTypeOf<'USD'>();
// The rest of the payment is the spec's own, unchanged on both branches.
expectTypeOf<CardPayment['refunded_amount']>().toEqualTypeOf<string>();
expectTypeOf<CryptoPayment['refund_status']>().toEqualTypeOf<'none' | 'partial' | 'full'>();
// The session and the order keep the spec's union: a session's currency follows how it is
// charged, not its payment's branch, so the SDK does not claim more than the spec says.
expectTypeOf(session.currency).toEqualTypeOf<'USDC' | 'USD'>();
expectTypeOf(order.currency).toEqualTypeOf<'USDC' | 'USD'>();

// "types the subscriber wallet per branch"
if (subscription.method === 'crypto') {
  expectTypeOf(subscription).toEqualTypeOf<CryptoSubscription>();
  expectTypeOf(subscription.customer.wallet).toEqualTypeOf<string>();
  expectTypeOf(subscription.currency).toEqualTypeOf<'USDC'>();
  expectTypeOf(subscription.card).toEqualTypeOf<null>();
  expectTypeOf(subscription.gateway).toEqualTypeOf<'solana'>();
}
if (subscription.method === 'card') {
  expectTypeOf(subscription).toEqualTypeOf<CardSubscription>();
  expectTypeOf(subscription.customer.wallet).toEqualTypeOf<null>();
  expectTypeOf(subscription.currency).toEqualTypeOf<'USD'>();
  expectTypeOf(subscription.card).toEqualTypeOf<PaymentCard | null>();
  expectTypeOf(subscription.gateway).toEqualTypeOf<'stripe'>();
}
expectTypeOf(subscription.customer.email).toEqualTypeOf<string | null>();
// payment / latest_payment are not narrowed: the top-level `method` says the rail (M3).
expectTypeOf(subscription.latest_payment).toEqualTypeOf<Subscription['latest_payment']>();

// "makes every order payment key null while unpaid"
expectTypeOf(order.payment).toEqualTypeOf<OrderPayment>();
if (order.payment.id === null) {
  expectTypeOf(order.payment.signature).toEqualTypeOf<null>();
  expectTypeOf(order.payment.gateway).toEqualTypeOf<null>();
  expectTypeOf(order.payment.method).toEqualTypeOf<null>();
} else {
  expectTypeOf(order.payment.id).toEqualTypeOf<string>();
  expectTypeOf(order.payment.method).toEqualTypeOf<PaymentMethod>();
}
if (order.payment.method === 'crypto') expectTypeOf(order.payment.signature).toEqualTypeOf<string>();
if (order.payment.method === 'card') {
  expectTypeOf(order.payment.signature).toEqualTypeOf<null>();
  expectTypeOf(order.payment.id).toEqualTypeOf<string>();
}
// @ts-expect-error a paid order payment never mixes the rails
const mixedOrderPayment: OrderPayment = { id: 'fian_pay_1', signature: 'sig', gateway: 'stripe', method: 'card' };
void mixedOrderPayment;
// @ts-expect-error an unpaid order payment is all null, never half
const halfUnpaid: OrderPayment = { id: null, signature: null, gateway: 'solana', method: null };
void halfUnpaid;

// "never gives a v1 session the all-null payment" (M2): v1 sends `payment: null` instead.
expectTypeOf(session.payment).toEqualTypeOf<PaidSessionPayment | null>();
// @ts-expect-error the all-null branch exists only in the session EVENT payload (Task 1b)
const allNullSessionPayment: CheckoutSession['payment'] = { id: null, status: null, signature: null, gateway: null, method: null };
void allNullSessionPayment;
if (session.payment?.method === 'card') {
  expectTypeOf(session.payment.signature).toEqualTypeOf<null>();
  expectTypeOf(session.payment.gateway).toEqualTypeOf<'stripe'>();
  expectTypeOf(session.payment.status).toEqualTypeOf<'PROCESSING' | 'CONFIRMED' | 'SUCCEEDED' | 'FAILED'>();
}
if (session.payment?.method === 'crypto') expectTypeOf(session.payment.signature).toEqualTypeOf<string>();

// "autocompletes payment_methods"
expectTypeOf<NonNullable<CheckoutSessionCreateParams['payment_methods']>>().toEqualTypeOf<PaymentMethod[]>();
const cardOnly: CheckoutSessionCreateParams = { ...amountWithDescription, payment_methods: ['card'] };
const bothRails: CheckoutSessionCreateParams = { ...amountWithDescription, payment_methods: ['crypto', 'card'] };
void cardOnly; void bothRails;
// @ts-expect-error 'paypal' is not a payment method
const paypal: CheckoutSessionCreateParams = { ...amountWithDescription, payment_methods: ['paypal'] };
void paypal;
// Edge: an empty list type-checks (the wire schema's minItems cannot be typed); the backend
// answers 400 validation_failed for it.
const noMethods: CheckoutSessionCreateParams = { ...amountWithDescription, payment_methods: [] };
void noMethods;

// Edge: a card payment from a Checkout that gave no email has an all-null customer (R1 row 3).
const anonymousCardPayment: CardPayment = {
  id: 'fian_pay_1', object: 'payment', status: 'SUCCEEDED', gateway: 'stripe', method: 'card', card: null,
  order_id: 'o-1', checkout_session_id: 'fian_cs_1', amount: '25000000', fee_amount: '0', network_fee_amount: '0',
  total_amount: '25000000', refund_status: 'none', refunded_amount: '0', currency: 'USD',
  customer: { id: null, wallet: null, email: null }, signature: null, slot: null, block_time: null,
  created_at: '2026-11-13T00:00:00.000Z', succeeded_at: '2026-11-13T00:00:00.000Z', failed_at: null, network: 'mainnet',
};
void anonymousCardPayment;
// @ts-expect-error a card payment has no signature
const cardWithSignature: CardPayment = { ...anonymousCardPayment, signature: 'sig' };
void cardWithSignature;
// @ts-expect-error a card subscriber has no wallet
const cardSubscriberWithWallet: CardSubscription['customer'] = { id: null, wallet: 'W', email: null, reference: null };
void cardSubscriberWithWallet;
// @ts-expect-error a card payer has no wallet
const cardPayerWithWallet: CardPayment['customer'] = { id: null, wallet: 'W', email: null };
void cardPayerWithWallet;
