import {
  createCheckoutHandler, createWebhookHandler,
  type CheckoutHandlerOptions, type WebhookHandlerOptions,
} from '@fianto/sdk/handlers';

/**
 * The App Router's second route-handler argument: `params` resolves to the route's dynamic
 * segments (`{}` for a static route such as app/api/checkout/route.ts).
 */
export interface RouteContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

/** `export const POST = Webhooks({ onOrderPaid })` in app/api/webhooks/fianto/route.ts */
export function Webhooks(options: WebhookHandlerOptions = {}): (request: Request) => Promise<Response> {
  return createWebhookHandler(options);
}

/**
 * `export const POST = Checkout({ createSession })` in app/api/checkout/route.ts.
 * `createSession(request, context)` receives the route context Next.js passes.
 */
export function Checkout(options: CheckoutHandlerOptions<RouteContext>): (request: Request, context?: RouteContext) => Promise<Response> {
  const handler = createCheckoutHandler(options);
  return (request, context) => handler(request, context ?? { params: Promise.resolve({}) });
}

export type { CheckoutHandlerOptions, CheckoutSessionParams, WebhookCallbacks, WebhookHandlerOptions } from '@fianto/sdk/handlers';
