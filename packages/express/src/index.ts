import {
  createCheckoutHandler, createWebhookHandler,
  type CheckoutHandlerOptions, type WebhookHandlerOptions,
} from '@fianto/sdk/handlers';
import { isFiantoError } from '@fianto/sdk';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { DEFAULT_LIMIT_BYTES, sendFetchResponse, toFetchRequest } from './bridge.js';

/**
 * What `checkout`'s `createSession(request, context)` receives: Express's own request (with
 * `req.user` and anything else earlier middleware set) and response. Read from `res`
 * (`res.locals`); never send a response through it — the handler sends its own.
 */
export interface ExpressContext {
  req: Request;
  res: Response;
}

function isPayloadTooLargeError(error: unknown): boolean {
  // Brand-based, cross-copy-safe check (see isFiantoError): PayloadTooLargeError extends
  // @fianto/sdk's FiantoError, so instanceof would fail across a dual-package install.
  return isFiantoError(error) && error.name === 'PayloadTooLargeError';
}

function adapt(
  handler: (request: globalThis.Request, context: ExpressContext) => Promise<globalThis.Response>,
  limitBytes: number,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    toFetchRequest(req, limitBytes)
      .then((request) => handler(request, { req, res }))
      .then((response) => sendFetchResponse(res, response))
      .catch((error: unknown) => {
        if (isPayloadTooLargeError(error)) {
          res.status(413).json({ error: 'payload_too_large' });
          return;
        }
        next(error);
      });
  };
}

/**
 * app.post('/webhooks/fianto', webhooks({ onOrderPaid })) — register it BEFORE express.json()
 * (route order), or give its route express.raw({ type: '*\/*' }). The body is read up to the
 * handler's `maxBodyBytes` (default 1 MiB); a larger one is answered 413.
 */
export function webhooks(options: WebhookHandlerOptions = {}): RequestHandler {
  const handler = createWebhookHandler(options);
  return adapt((request) => handler(request), options.maxBodyBytes ?? DEFAULT_LIMIT_BYTES);
}

/**
 * app.post('/api/checkout', checkout({ createSession })) — register it BEFORE express.json().
 * `createSession(request, { req, res })` receives Express's own request and response.
 */
export function checkout(options: CheckoutHandlerOptions<ExpressContext>): RequestHandler {
  return adapt(createCheckoutHandler(options), DEFAULT_LIMIT_BYTES);
}

export type { CheckoutHandlerOptions, CheckoutSessionParams, WebhookCallbacks, WebhookHandlerOptions } from '@fianto/sdk/handlers';
