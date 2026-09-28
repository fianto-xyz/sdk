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
  data: unknown;
}

export const WEBHOOK_EVENT_TYPES = [
  'checkout.session.completed', 'checkout.session.expired', 'checkout.session.canceled',
  'order.paid', 'order.expired', 'order.duplicate_payment',
  'subscription.created', 'subscription.renewed', 'subscription.past_due', 'subscription.payment_failed',
  'subscription.ended', 'subscription.cancel_scheduled', 'subscription.cancel_withdrawn',
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
