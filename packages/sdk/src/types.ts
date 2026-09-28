import type { components, operations } from './generated/api.js';

type S = components['schemas'];
type Query<Op extends keyof operations> = NonNullable<operations[Op]['parameters']['query']>;

export type Application = S['ApiApplicationResponse'];
export type CheckoutSession = S['ApiSessionResponse'];
export type CheckoutSessionCreateParams = S['CreateCheckoutSessionDto'];
export type Payment = S['ApiPaymentResponse'];
export type Order = S['ApiOrderResponse'];
export type Subscription = S['ApiSubscriptionResponse'];
export type SubscriptionCancelParams = S['CancelSubscriptionDto'];
export type Product = S['ApiProductResponse'];
export type Price = S['ApiPriceResponse'];
export type Event = S['ApiEventResponse'];
export type TestEventResult = S['ApiTestEventResponse'];

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
