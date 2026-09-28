import {
  createCheckoutHandler, createWebhookHandler,
  type CheckoutHandlerOptions, type WebhookHandlerOptions,
} from '@fianto/sdk/handlers';

/** `export const POST = Webhooks({ onOrderPaid })` in app/api/webhooks/fianto/route.ts */
export function Webhooks(options: WebhookHandlerOptions = {}): (request: Request) => Promise<Response> {
  return createWebhookHandler(options);
}

/** `export const POST = Checkout({ createSession })` in app/api/checkout/route.ts */
export function Checkout(options: CheckoutHandlerOptions): (request: Request) => Promise<Response> {
  return createCheckoutHandler(options);
}

export type { CheckoutHandlerOptions, CheckoutSessionParams, WebhookCallbacks, WebhookHandlerOptions } from '@fianto/sdk/handlers';
