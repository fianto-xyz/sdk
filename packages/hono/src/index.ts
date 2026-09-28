import type { Context } from 'hono';
import {
  createCheckoutHandler, createWebhookHandler,
  type CheckoutHandlerOptions, type WebhookHandlerOptions,
} from '@fianto/sdk/handlers';

/** app.post('/webhooks/fianto', webhooks({ onOrderPaid })) */
export function webhooks(options: WebhookHandlerOptions = {}): (c: Context) => Promise<Response> {
  const handler = createWebhookHandler(options);
  return (c) => handler(c.req.raw);
}

/** app.post('/api/checkout', checkout({ createSession })) */
export function checkout(options: CheckoutHandlerOptions): (c: Context) => Promise<Response> {
  const handler = createCheckoutHandler(options);
  return (c) => handler(c.req.raw);
}

export type { CheckoutHandlerOptions, CheckoutSessionParams, WebhookCallbacks, WebhookHandlerOptions } from '@fianto/sdk/handlers';
