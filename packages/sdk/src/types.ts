import type { components, operations } from './generated/api.js';
import type { UnknownWebhookEvent, WebhookEventOf, WebhookEventType } from './webhooks/events.js';

type S = components['schemas'];
type Query<Op extends keyof operations> = NonNullable<operations[Op]['parameters']['query']>;

export type Application = S['ApiApplicationResponse'];
export type CheckoutSession = S['ApiSessionResponse'];

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

export type Payment = S['ApiPaymentResponse'];
export type Order = S['ApiOrderResponse'];
export type Subscription = S['ApiSubscriptionResponse'];
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

export interface Page<T, C> {
  items: T[];
  next_cursor: C | null;
}
