import type { Network } from '../core/config.js';
import type { components } from '../generated/api.js';
import type { CardPayment, CryptoPayment, PaymentCard } from '../types.js';

type S = components['schemas'];
type PaymentStatus = S['ApiPaymentResponse']['status'];

/**
 * A paid payment as an event names it. `gateway` and `method` are absent on an event stored
 * before card payments (November 2026); such a payment is crypto, so the crypto branch leaves
 * them optional.
 *
 * Branch with `if (payment.method === 'card') … else …` (crypto). Never test `=== 'crypto'` for
 * the crypto branch: an older event (a late retry, a replay, `events.list`) has no `method` key
 * and would match neither.
 */
type EventPaidPayment =
  | { id: string; signature: string; gateway?: 'solana'; method?: 'crypto' }
  | { id: string; signature: null; gateway: 'stripe'; method: 'card' };

/** No payment yet: every key null (`gateway`/`method` absent on an event stored before card payments). */
type EventUnpaidPayment = { id: null; signature: null; gateway?: null; method?: null };

/**
 * An order event's `payment`. Check `method` before reading `signature`: it is the Solana
 * signature on crypto and null on `card`. Every key is null while nothing pays the order.
 */
type OrderEventPayment = EventPaidPayment | EventUnpaidPayment;

/**
 * A `checkout.session.*` event's `payment`: an order event payment plus its `status` (absent on
 * events stored before 2026-09-28). Unlike the v1 session (`payment: null`), the event keeps the
 * all-null object while there is no payment.
 */
type SessionEventPayment = (EventPaidPayment & { status?: PaymentStatus }) | (EventUnpaidPayment & { status?: null });

/** `checkout.session.*`. `currency` is "USD" when the session is card-only or a card paid it. */
type SessionEvent = Omit<S['SessionEventPayload'], 'payment'> & { payment: SessionEventPayment };

/** `order.paid` / `order.expired`. */
type OrderEvent = Omit<S['OrderEventPayload'], 'payment'> & { payment: OrderEventPayment };

/**
 * `order.duplicate_payment`. `duplicate` is the payment nobody asked for: a crypto transfer has
 * its `signature` and no `gateway`; a card charge has `gateway: 'stripe'` and `signature` null,
 * and fianto refunds it in full automatically.
 */
type OrderDuplicatePaymentEvent = Omit<S['OrderDuplicatePaymentPayload'], 'payment' | 'duplicate'> & {
  payment: OrderEventPayment;
  duplicate: { signature: string; amount: string; gateway?: never } | { signature: null; amount: string; gateway: 'stripe' };
};

type SubscriptionEventCommon = Omit<S['SubscriptionEventPayload'], 'gateway' | 'method' | 'card' | 'currency' | 'customer'>;
type SubscriptionEventCustomer = S['SubscriptionEventPayload']['customer'];

/**
 * A `subscription.*` event, discriminated by `method`. `gateway`, `method` and `card` are absent
 * on an event stored before card subscriptions (November 2026); such a subscription is crypto.
 * A card subscription reads `currency` "USD", fees "0", `plan_id` null and `customer.wallet` null.
 * Branch with `if (data.method === 'card') … else …`, never `=== 'crypto'`, for the same reason
 * as an order's payment: an older event has no `method` key.
 */
type SubscriptionEvent =
  | (SubscriptionEventCommon & {
      gateway?: 'solana';
      method?: 'crypto';
      card?: null;
      currency: 'USDC';
      customer: SubscriptionEventCustomer & { wallet: string };
    })
  | (SubscriptionEventCommon & {
      gateway: 'stripe';
      method: 'card';
      card: PaymentCard | null;
      currency: 'USD';
      customer: SubscriptionEventCustomer & { wallet: null };
    });

/** A payment inside an event: the v1 `Payment`, without `network` (the event envelope carries it). */
type EventPayment = Omit<CryptoPayment, 'network'> | Omit<CardPayment, 'network'>;

/**
 * `payment.refunded`: the payment right after its refunded figure moved, and what moved it.
 *
 * An event is published only when `payment.refunded_amount` moved, and every move publishes
 * one. `refund.status` says which way: `succeeded` and `dispute_lost` add `refund.applied_amount`
 * (always more than 0); `failed` and `reversed` take it away. A refund that succeeds or fails
 * while a lost dispute covers the payment publishes nothing; the dispute's later `reversed`
 * carries it, so a `reversed` need not equal the dispute's `dispute_lost`: never undo the
 * `dispute_lost` when the `reversed` comes, just add the signed `applied_amount`. One card refund
 * can also be two `succeeded` events with the same `refund.id`.
 *
 * To follow the figure, add `refundDelta(event.data)` once per EVENT id (never pair or dedupe
 * events by `refund.id`, and never sum `refund.amount`), on a total seeded from
 * `GET /v1/payments/{id}` (`refunded_amount`). Events arrive late, twice or out of order, so the
 * last one delivered is not always the newest; a seeded total is exact only when none of the
 * payment's events was in flight while the seed was read, so compare it with
 * `GET /v1/payments/{id}`, which always has the current figure.
 */
export type PaymentRefundedEvent = { payment: EventPayment; refund: S['PaymentRefundedPayload']['refund'] };

/** `payment.disputed`: a card payment and its dispute, on a new dispute and on each change of its status. */
export type PaymentDisputedEvent = { payment: Omit<CardPayment, 'network'>; dispute: S['PaymentDisputedPayload']['dispute'] };

export interface WebhookEventMap {
  'checkout.session.completed': SessionEvent;
  'checkout.session.expired': SessionEvent;
  'checkout.session.canceled': SessionEvent;
  'order.paid': OrderEvent;
  'order.expired': OrderEvent;
  'order.duplicate_payment': OrderDuplicatePaymentEvent;
  'payment.refunded': PaymentRefundedEvent;
  'payment.disputed': PaymentDisputedEvent;
  'subscription.created': SubscriptionEvent;
  'subscription.renewed': SubscriptionEvent;
  'subscription.past_due': SubscriptionEvent;
  'subscription.payment_failed': SubscriptionEvent;
  'subscription.ended': SubscriptionEvent;
  'subscription.cancel_scheduled': SubscriptionEvent;
  'subscription.cancel_withdrawn': SubscriptionEvent;
  'invoice.issued': S['InvoiceEventPayload'];
  'invoice.paid': S['InvoiceEventPayload'];
  'invoice.voided': S['InvoiceEventPayload'];
  'invoice.payment_recorded': S['InvoicePaymentRecordedPayload'];
  'credit_note.issued': S['InvoiceEventPayload'];
  'test.event': S['TestEventPayload'];
}

export type WebhookEventType = keyof WebhookEventMap;

export interface WebhookEventOf<T extends WebhookEventType> {
  /** evt_<32 hex>. Equal to the `webhook-id` header; stable across retries. Deduplicate on it. */
  id: string;
  type: T;
  timestamp: string;
  /** The network that sent the event: `mainnet` or `devnet` (the sandbox). */
  network: Network;
  data: WebhookEventMap[T];
}

/** Sent once when a webhook URL is set; answer HTTP 200 with {"challenge": data.challenge}. */
export interface EndpointVerificationEvent {
  type: 'endpoint.verification';
  timestamp: string;
  /** The network that sent the event: `mainnet` or `devnet` (the sandbox). */
  network: Network;
  data: S['EndpointVerificationPayload'];
}

/**
 * Every business event this SDK version knows — what `onEvent`/`onError` receive. The URL probe
 * is not in it: the webhook handler answers that one itself.
 */
export type FiantoWebhookEvent = { [K in WebhookEventType]: WebhookEventOf<K> }[WebhookEventType];

/**
 * What `verifyWebhook` returns: every known event, plus the URL probe (no `id`). A closed union,
 * so `switch (event.type)` narrows `event.data` with no cast.
 *
 * fianto may add event types after this SDK version ships, and a newer type still reaches your
 * code at runtime (its shape is `UnknownWebhookEvent`). Give every `switch (event.type)` a
 * `default:` branch that ignores what it does not handle (answer 2xx, never throw), or check
 * `isKnownEventType(event.type)` first.
 */
export type WebhookEvent = FiantoWebhookEvent | EndpointVerificationEvent;

/**
 * The runtime shape of an event type this SDK version does not know yet. `verifyWebhook` and
 * `onEvent` are typed with the known union (`WebhookEvent`/`FiantoWebhookEvent`); use this in
 * a `default:` branch or wherever you handle events defensively.
 */
export interface UnknownWebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  /** The network that sent the event: `mainnet` or `devnet` (the sandbox). */
  network: Network;
  data: unknown;
}

// The order follows the backend's `WEBHOOK_EVENTS` (src/cli/openapi/webhooks.ts), minus
// `endpoint.verification`; keep WebhookEventMap and the handler's callbacks in the same order.
// events.test.ts checks the set against spec/openapi.json, which cannot check the order (the
// spec's `webhooks` object is serialised alphabetically).
export const WEBHOOK_EVENT_TYPES = [
  'checkout.session.completed', 'checkout.session.expired', 'checkout.session.canceled',
  'order.paid', 'order.expired', 'order.duplicate_payment',
  'payment.refunded', 'payment.disputed',
  'subscription.created', 'subscription.renewed', 'subscription.past_due', 'subscription.payment_failed',
  'subscription.ended', 'subscription.cancel_scheduled', 'subscription.cancel_withdrawn',
  'invoice.issued', 'invoice.paid', 'invoice.voided', 'invoice.payment_recorded', 'credit_note.issued',
  'test.event',
] as const satisfies readonly WebhookEventType[];

const KNOWN: ReadonlySet<string> = new Set(WEBHOOK_EVENT_TYPES);

/** True for an event type this SDK version knows (the URL probe's `endpoint.verification` is not one). */
export function isKnownEventType(type: string): type is WebhookEventType {
  return KNOWN.has(type);
}

export function isEventType<T extends WebhookEventType>(event: { type: string }, type: T): event is WebhookEventOf<T> {
  return event.type === type;
}
