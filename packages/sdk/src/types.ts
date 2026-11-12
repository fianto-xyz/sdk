import type { components, operations } from './generated/api.js';
import type { UnknownWebhookEvent, WebhookEventOf, WebhookEventType } from './webhooks/events.js';

type S = components['schemas'];
type Query<Op extends keyof operations> = NonNullable<operations[Op]['parameters']['query']>;

export type Application = S['ApiApplicationResponse'];

/** How the payer paid: `crypto` (a wallet, on Solana) or `card` (through the merchant's Stripe). */
export type PaymentMethod = 'crypto' | 'card';

/** The card a card payment or subscription used. Either half is null when it was not reported. */
export interface PaymentCard {
  brand: string | null;
  last4: string | null;
}

/** A paid order's or session's payment, discriminated by `method` (or `gateway`). */
type PaidPayment =
  | { id: string; signature: string; gateway: 'solana'; method: 'crypto' }
  | { id: string; signature: null; gateway: 'stripe'; method: 'card' };

/** An order's payment while nothing pays it: every key is null. */
type UnpaidPayment = { id: null; signature: null; gateway: null; method: null };

/**
 * `order.payment`: `{ id, signature, gateway, method }`. Check `method` before reading
 * `signature`: it is the Solana signature on `crypto` and null on `card` (no chain
 * transaction). Every key is null while nothing pays the order.
 */
export type OrderPayment = PaidPayment | UnpaidPayment;

/** `session.payment` when the session has one: an order payment plus its `status`. */
export type PaidSessionPayment = PaidPayment & { status: S['ApiPaymentResponse']['status'] };

/**
 * A checkout session. `payment` is null while there is none (v1 never sends the all-null
 * object). `currency` is "USD" when the session is card-only or a card has paid it, otherwise
 * "USDC"; amounts are 6-decimal base units either way, so format them with `money.format`.
 */
export type CheckoutSession = Omit<S['ApiSessionResponse'], 'payment'> & { payment: PaidSessionPayment | null };

type CreateCheckoutSessionDto = S['CreateCheckoutSessionDto'];
type CheckoutSessionCommon = Omit<CreateCheckoutSessionDto, 'amount' | 'description' | 'price_id'>;

/**
 * The real backend requires either `price_id` alone, or `amount` together with `description`
 * (a price-less checkout has no product name to show, so `description` stands in for it) —
 * 400 `amount_or_price_required` otherwise. The generated DTO leaves all three optional (it
 * mirrors the wire schema, which cannot express the either/or), so this union is hand-derived
 * from it (never edit `generated/`) to catch the mistake at the type level instead.
 */
export type CheckoutSessionCreateParams = CheckoutSessionCommon &
  (
    | { price_id: NonNullable<CreateCheckoutSessionDto['price_id']>; amount?: never; description?: NonNullable<CreateCheckoutSessionDto['description']> }
    | { amount: NonNullable<CreateCheckoutSessionDto['amount']>; description: NonNullable<CreateCheckoutSessionDto['description']>; price_id?: never }
  );

type PaymentCommon = Omit<
  S['ApiPaymentResponse'],
  'gateway' | 'method' | 'card' | 'currency' | 'signature' | 'slot' | 'block_time'
>;

/** A payment made with a wallet on Solana: it always has its chain transaction. */
export type CryptoPayment = PaymentCommon & {
  gateway: 'solana';
  method: 'crypto';
  currency: 'USDC';
  card: null;
  signature: string;
  slot: string | null;
  block_time: string | null;
};

/**
 * A payment made by card through the merchant's Stripe. It has no chain transaction
 * (`signature`, `slot` and `block_time` are null), fianto takes no fee on it (`fee_amount` and
 * `network_fee_amount` read "0"), and `customer.wallet` is null; every key of `customer` is null
 * when checkout collected no email. Amounts are 6-decimal base units of US dollars.
 */
export type CardPayment = PaymentCommon & {
  gateway: 'stripe';
  method: 'card';
  currency: 'USD';
  card: PaymentCard | null;
  signature: null;
  slot: null;
  block_time: null;
};

/** A payment of either rail. Narrow on `method` (or `gateway`) before reading `signature` or `card`. */
export type Payment = CryptoPayment | CardPayment;

/** An order. `payment` says how it was paid; see `OrderPayment`. */
export type Order = Omit<S['ApiOrderResponse'], 'payment'> & { payment: OrderPayment };

type SubscriptionCommon = Omit<S['ApiSubscriptionResponse'], 'gateway' | 'method' | 'card' | 'currency' | 'customer'>;
type SubscriptionCustomer = S['ApiSubscriptionResponse']['customer'];

/** A subscription charged on Solana from the subscriber's wallet. */
export type CryptoSubscription = SubscriptionCommon & {
  gateway: 'solana';
  method: 'crypto';
  currency: 'USDC';
  card: null;
  customer: SubscriptionCustomer & { wallet: string };
};

/**
 * A subscription charged by card through the merchant's Stripe: `currency` "USD", fees "0",
 * `plan_id` null and `customer.wallet` null.
 */
export type CardSubscription = SubscriptionCommon & {
  gateway: 'stripe';
  method: 'card';
  currency: 'USD';
  card: PaymentCard | null;
  customer: SubscriptionCustomer & { wallet: null };
};

/**
 * A subscription of either rail, discriminated by `method` (or `gateway`). Its `latest_payment`
 * is not narrowed per rail: the subscription's own `method` says how it is paid.
 */
export type Subscription = CryptoSubscription | CardSubscription;
export type SubscriptionCancelParams = S['CancelSubscriptionDto'];
export type Product = S['ApiProductResponse'];
export type Price = S['ApiPriceResponse'];
export type TestEventResult = S['ApiTestEventResponse'];

/**
 * What `events.retrieve`/`events.list` return: the same typed union `webhooks` delivers,
 * plus `object: 'event'` (the wire's own discriminator). Named `FiantoEvent`, not `Event` —
 * the generated schema's name shadows the DOM global, which broke `instanceof Event` and
 * similar checks for anyone importing it (F12).
 */
export type FiantoEvent =
  | { [K in WebhookEventType]: WebhookEventOf<K> & { object: 'event' } }[WebhookEventType]
  | (UnknownWebhookEvent & { object: 'event' });

export type OrderListParams = Query<'orders.list'>;
export type PaymentListParams = Query<'payments.list'>;
export type SubscriptionListParams = Query<'subscriptions.list'>;
export type ProductListParams = Query<'products.list'>;
export type PriceListParams = Query<'prices.list'>;
export type EventListParams = Query<'events.list'>;

/**
 * A `next_cursor` is always this opaque string (or `null`, on the last page) — every `list()`
 * normalises it, whatever the wire sent (F7/A7; see `core/pagination.ts`'s `stringifyCursor`).
 */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
