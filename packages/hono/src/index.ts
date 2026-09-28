import type { Context, Env } from 'hono';
import {
  createCheckoutHandler, createWebhookHandler,
  type CheckoutHandlerOptions, type WebhookHandlerOptions,
} from '@fianto/sdk/handlers';

/** app.post('/webhooks/fianto', webhooks({ onOrderPaid })) */
export function webhooks(options: WebhookHandlerOptions = {}): (c: Context) => Promise<Response> {
  const handler = createWebhookHandler(options);
  return (c) => handler(c.req.raw);
}

/**
 * app.post('/api/checkout', checkout({ createSession })). `createSession(request, c)` receives
 * the Hono Context (`c.env`, `c.var`, …); pass your app's Env as the type argument to type it:
 * `checkout<{ Bindings: Bindings }>({ … })`.
 */
// `any` matches Hono's own default for Context's Env, so an untyped app keeps `c.env: any`.
export function checkout<E extends Env = any>(options: CheckoutHandlerOptions<Context<E>>): (c: Context<E>) => Promise<Response> {
  const handler = createCheckoutHandler(options);
  return (c) => handler(c.req.raw, c);
}

export type { CheckoutHandlerOptions, CheckoutSessionParams, WebhookCallbacks, WebhookHandlerOptions } from '@fianto/sdk/handlers';
