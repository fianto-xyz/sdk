import type { components } from '../generated/api.js';

type S = components['schemas'];

export interface WebhookEventMap {
  'checkout.session.completed': S['SessionEventPayload'];
  'checkout.session.expired': S['SessionEventPayload'];
  'checkout.session.canceled': S['SessionEventPayload'];
  'order.paid': S['OrderEventPayload'];
  'order.expired': S['OrderEventPayload'];
  'order.duplicate_payment': S['OrderDuplicatePaymentPayload'];
  'subscription.created': S['SubscriptionEventPayload'];
  'subscription.renewed': S['SubscriptionEventPayload'];
  'subscription.past_due': S['SubscriptionEventPayload'];
  'subscription.payment_failed': S['SubscriptionEventPayload'];
  'subscription.ended': S['SubscriptionEventPayload'];
  'subscription.cancel_scheduled': S['SubscriptionEventPayload'];
  'subscription.cancel_withdrawn': S['SubscriptionEventPayload'];
  'test.event': S['TestEventPayload'];
}

export type WebhookEventType = keyof WebhookEventMap;

export interface WebhookEventOf<T extends WebhookEventType> {
  /** evt_<32 hex>. Equal to the `webhook-id` header; stable across retries. Deduplicate on it. */
  id: string;
  type: T;
  timestamp: string;
  data: WebhookEventMap[T];
}

/** Sent once when a webhook URL is set; answer HTTP 200 with {"challenge": data.challenge}. */
export interface EndpointVerificationEvent {
  type: 'endpoint.verification';
  timestamp: string;
  data: S['EndpointVerificationPayload'];
}

export type WebhookEvent = { [K in WebhookEventType]: WebhookEventOf<K> }[WebhookEventType] | EndpointVerificationEvent;

/** A type this SDK version does not know yet. Narrow known ones with isEventType(). */
export interface UnknownWebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data: unknown;
}

export const WEBHOOK_EVENT_TYPES = [
  'checkout.session.completed', 'checkout.session.expired', 'checkout.session.canceled',
  'order.paid', 'order.expired', 'order.duplicate_payment',
  'subscription.created', 'subscription.renewed', 'subscription.past_due', 'subscription.payment_failed',
  'subscription.ended', 'subscription.cancel_scheduled', 'subscription.cancel_withdrawn',
  'test.event',
] as const satisfies readonly WebhookEventType[];

export function isEventType<T extends WebhookEventType>(event: { type: string }, type: T): event is WebhookEventOf<T> {
  return event.type === type;
}
