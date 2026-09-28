import {
  createCheckoutHandler, createWebhookHandler,
  type CheckoutHandlerOptions, type WebhookHandlerOptions,
} from '@fianto/sdk/handlers';
import { isFiantoError } from '@fianto/sdk';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { sendFetchResponse, toFetchRequest } from './bridge.js';

function isPayloadTooLargeError(error: unknown): boolean {
  // Brand-based, cross-copy-safe check (see isFiantoError): PayloadTooLargeError extends
  // @fianto/sdk's FiantoError, so instanceof would fail across a dual-package install.
  return isFiantoError(error) && error.name === 'PayloadTooLargeError';
}

function adapt(handler: (request: globalThis.Request) => Promise<globalThis.Response>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    toFetchRequest(req)
      .then(handler)
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

/** app.post('/webhooks/fianto', webhooks({ onOrderPaid })) — mount BEFORE express.json(). */
export function webhooks(options: WebhookHandlerOptions = {}): RequestHandler {
  return adapt(createWebhookHandler(options));
}

/** app.post('/api/checkout', checkout({ createSession })) — mount BEFORE express.json(). */
export function checkout(options: CheckoutHandlerOptions): RequestHandler {
  return adapt(createCheckoutHandler(options));
}

export type { CheckoutHandlerOptions, CheckoutSessionParams, WebhookCallbacks, WebhookHandlerOptions } from '@fianto/sdk/handlers';
