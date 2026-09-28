export class FiantoCheckoutError extends Error {
  override name = 'FiantoCheckoutError';
  constructor(readonly code: string, message: string) { super(message); }
}
export class PopupBlockedError extends FiantoCheckoutError {
  override name = 'PopupBlockedError';
  constructor() { super('popup_blocked', 'The browser blocked the checkout popup. Call openCheckout() directly inside a click handler.'); }
}
export class InvalidSessionError extends FiantoCheckoutError {
  override name = 'InvalidSessionError';
  constructor(message: string) { super('invalid_session', message); }
}

/**
 * Codes a checkout route built with `createCheckoutHandler` (`@fianto/sdk/handlers`) answers
 * with, plus two of this package's own: `network_error` (the request never got a response) and
 * `session_request_failed` (an error status with no `{ error: { code } }` body). Any other string
 * is possible too: the route may relay a validation code for its own params.
 */
export type CheckoutSessionErrorCode =
  | 'payment_in_progress'
  | 'order_already_paid'
  | 'order_session_mismatch'
  | 'checkout_unavailable'
  | 'rate_limited'
  | 'session_not_reissuable'
  | 'subscription_preparing'
  | 'plan_limit_reached'
  | 'forbidden_origin'
  | 'method_not_allowed'
  | 'internal_error'
  | 'network_error'
  | 'session_request_failed'
  | (string & {});

/**
 * Your checkout route refused to create a session. `code` is the route's `error.code`; `message`
 * is the route's own message, written for you, not for the payer. `status` is the HTTP status
 * (absent when the error body reached `openCheckout` without the response, e.g. from
 * `fetch().then((r) => r.json())`), `retryAfter` the `Retry-After` header in seconds.
 */
export class CheckoutSessionError extends FiantoCheckoutError {
  override name = 'CheckoutSessionError';
  declare readonly code: CheckoutSessionErrorCode;
  constructor(code: CheckoutSessionErrorCode, message: string, readonly status?: number, readonly retryAfter?: number) {
    super(code, message);
  }
}
