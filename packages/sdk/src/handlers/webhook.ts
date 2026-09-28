import { WebhookVerificationError } from '../webhooks/errors.js';
import type { UnknownWebhookEvent, WebhookEvent, WebhookEventOf, WebhookEventType } from '../webhooks/events.js';
import { verifyWebhook } from '../webhooks/verify.js';
import { json } from './respond.js';

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
  secret?: string | readonly string[];
  toleranceSeconds?: number;
  /** Runs after the type's own callback, for every verified event except the URL probe. */
  onEvent?: (event: WebhookEvent | UnknownWebhookEvent) => unknown;
  /** The reason a request was rejected (the response itself never says). */
  onVerificationError?: (error: WebhookVerificationError) => void;
  /** A callback or onEvent threw (the response is still 500, so fianto retries). */
  onError?: (error: unknown, event: WebhookEvent | UnknownWebhookEvent) => void;
}

function report(fn: () => void): void {
  try {
    fn();
  } catch {
    // A throwing reporter must not change the response.
  }
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
  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
    let event: WebhookEvent | UnknownWebhookEvent;
    try {
      const body = new Uint8Array(await request.arrayBuffer());
      event = await verifyWebhook(body, request.headers, { secret: options.secret, toleranceSeconds: options.toleranceSeconds });
    } catch (error) {
      if (!(error instanceof WebhookVerificationError)) throw error;
      report(() => options.onVerificationError?.(error));
      return json(400, { error: 'invalid_webhook' });
    }
    if (event.type === 'endpoint.verification') {
      return json(200, { challenge: (event as WebhookEvent & { type: 'endpoint.verification' }).data.challenge });
    }
    try {
      const name = Object.hasOwn(CALLBACKS, event.type) ? CALLBACKS[event.type as WebhookEventType] : undefined;
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
