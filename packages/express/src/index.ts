import {
  createCheckoutHandler, createWebhookHandler,
  type CheckoutHandlerOptions, type WebhookHandlerOptions,
} from '@fianto/sdk/handlers';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { PayloadTooLargeError, sendFetchResponse, toFetchRequest } from './bridge.js';

function adapt(handler: (request: globalThis.Request) => Promise<globalThis.Response>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    toFetchRequest(req)
      .then(handler)
      .then((response) => sendFetchResponse(res, response))
      .catch((error: unknown) => {
        if (error instanceof PayloadTooLargeError) {
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
