import { isWebhookVerificationError, type WebhookVerificationError } from '../webhooks/errors.js';
import type { FiantoWebhookEvent, WebhookEvent, WebhookEventOf, WebhookEventType } from '../webhooks/events.js';
import { readSignedHeaders, resolveTolerance, secretKeys, signedPrefix, verifySignedContent } from '../webhooks/verify.js';
import { readBoundedBody, resolveMaxBodyBytes } from './body.js';
import { json, report } from './respond.js';

type Callback<T extends WebhookEventType> = (event: WebhookEventOf<T>) => unknown;

export interface WebhookCallbacks {
  onCheckoutSessionCompleted?: Callback<'checkout.session.completed'>;
  onCheckoutSessionExpired?: Callback<'checkout.session.expired'>;
  onCheckoutSessionCanceled?: Callback<'checkout.session.canceled'>;
  onOrderPaid?: Callback<'order.paid'>;
  onOrderExpired?: Callback<'order.expired'>;
  onOrderDuplicatePayment?: Callback<'order.duplicate_payment'>;
  onSubscriptionCreated?: Callback<'subscription.created'>;
  onSubscriptionRenewed?: Callback<'subscription.renewed'>;
  onSubscriptionPastDue?: Callback<'subscription.past_due'>;
  onSubscriptionPaymentFailed?: Callback<'subscription.payment_failed'>;
  onSubscriptionEnded?: Callback<'subscription.ended'>;
  onSubscriptionCancelScheduled?: Callback<'subscription.cancel_scheduled'>;
  onSubscriptionCancelWithdrawn?: Callback<'subscription.cancel_withdrawn'>;
  onTestEvent?: Callback<'test.event'>;
}

export interface WebhookHandlerOptions extends WebhookCallbacks {
  /**
   * `whsec_` + base64 of a key of at least 16 bytes, or several during a roll. Checked when the
   * handler is created. Default: process.env.FIANTO_WEBHOOK_SECRET, read on each request.
   */
  secret?: string | readonly string[];
  /** Default 300, between 1 and 3600. */
  toleranceSeconds?: number;
  /**
   * The largest body accepted, in bytes. Default 1_048_576 (1 MiB). A larger body is answered
   * 413 as soon as its content-length or the bytes received pass the limit, never read in full.
   */
  maxBodyBytes?: number;
  /**
   * Runs after the type's own callback, for every verified event except the URL probe.
   * Typed with the events this SDK version knows, so `switch (event.type)` narrows; a type
   * added to fianto later still arrives at runtime, so give the switch a `default:` branch that
   * ignores it (or check `isKnownEventType(event.type)`).
   */
  onEvent?: (event: FiantoWebhookEvent) => unknown;
  /** The reason a request was rejected (the response itself never says). */
  onVerificationError?: (error: WebhookVerificationError) => void;
  /**
   * A callback or onEvent threw (the response is still 500, so fianto retries). `event` is
   * typed with the event types this SDK version knows, but at runtime it can also be an event
   * of a type this version doesn't know yet (when `onEvent` throws for one) — the same caveat
   * `onEvent` itself documents.
   */
  onError?: (error: unknown, event: FiantoWebhookEvent) => void;
}

const CALLBACKS: { [K in WebhookEventType]: keyof WebhookCallbacks } = {
  'checkout.session.completed': 'onCheckoutSessionCompleted',
  'checkout.session.expired': 'onCheckoutSessionExpired',
  'checkout.session.canceled': 'onCheckoutSessionCanceled',
  'order.paid': 'onOrderPaid',
  'order.expired': 'onOrderExpired',
  'order.duplicate_payment': 'onOrderDuplicatePayment',
  'subscription.created': 'onSubscriptionCreated',
  'subscription.renewed': 'onSubscriptionRenewed',
  'subscription.past_due': 'onSubscriptionPastDue',
  'subscription.payment_failed': 'onSubscriptionPaymentFailed',
  'subscription.ended': 'onSubscriptionEnded',
  'subscription.cancel_scheduled': 'onSubscriptionCancelScheduled',
  'subscription.cancel_withdrawn': 'onSubscriptionCancelWithdrawn',
  'test.event': 'onTestEvent',
};

/**
 * A `(Request) => Response` webhook endpoint: verifies the signature over the raw body, answers
 * the URL-verification probe itself, and calls your typed callbacks. Delivery is at-least-once and
 * unordered: make callbacks idempotent (dedupe on event.id) and fast (fianto waits 10 s).
 */
export function createWebhookHandler(options: WebhookHandlerOptions = {}): (request: Request) => Promise<Response> {
  // Configuration mistakes fail here, when the route is set up, not on the first delivery.
  const tolerance = resolveTolerance(options.toleranceSeconds);
  const maxBodyBytes = resolveMaxBodyBytes(options.maxBodyBytes);
  if (options.secret !== undefined) secretKeys(options.secret);

  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
    let event: WebhookEvent;
    try {
      // Headers, timestamp and secret first: a request that cannot verify is refused unread.
      const signed = readSignedHeaders(request.headers, tolerance, Date.now());
      const keys = secretKeys(options.secret);
      const prefix = signedPrefix(signed);
      const content = await readBoundedBody(request, prefix, maxBodyBytes);
      event = await verifySignedContent(content, prefix.length, signed, keys);
    } catch (error) {
      if (!isWebhookVerificationError(error)) throw error;
      report(() => options.onVerificationError?.(error));
      if (error.reason === 'payload_too_large') return json(413, { error: 'payload_too_large' });
      return json(400, { error: 'invalid_webhook' });
    }
    if (event.type === 'endpoint.verification') return json(200, { challenge: event.data.challenge });
    try {
      const name = Object.hasOwn(CALLBACKS, event.type) ? CALLBACKS[event.type] : undefined;
      const callback = name ? (options[name] as ((e: unknown) => unknown) | undefined) : undefined;
      await callback?.(event);
      await options.onEvent?.(event);
    } catch (error) {
      report(() => options.onError?.(error, event));
      return json(500, { error: 'handler_failed' });
    }
    return json(200, { received: true });
  };
}
