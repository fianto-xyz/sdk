import { isAPIError, isFiantoError } from '../core/errors.js';
import { json } from './respond.js';

/**
 * The only error codes `createCheckoutHandler` relays to the browser, each with the SDK's own
 * message (never the API's wording): what a payer-facing UI can act on, plus validation codes
 * for the merchant's own params so a misconfigured route is visible in development. Everything
 * else — any other code, every 5xx, and 401/403 (credentials) — becomes a generic 500; the
 * original error always goes to `onError`.
 */
const RELAYED: Readonly<Record<string, string>> = {
  // The payer can act on these (wait, retry, or stop).
  payment_in_progress: 'A payment for this order is already being processed. Wait for it to finish before trying again.',
  order_already_paid: 'This order has already been paid.',
  checkout_unavailable: 'Checkout is unavailable right now. Try again in a moment.',
  rate_limited: 'Too many checkout attempts. Try again in a moment.',
  session_not_reissuable: 'The open checkout for this order can no longer be reopened. Try again in a few minutes.',
  subscription_preparing: 'The subscription is still being prepared. Try again in a few seconds.',
  plan_limit_reached: 'This shop cannot start new subscriptions right now. Try again later.',
  order_session_mismatch:
    'This order already has an open checkout with different terms. Use a new order_id for the new terms ' +
    '(for example, include a cart version), or cancel the open checkout session first.',
  // The merchant's own checkout params were refused.
  validation_failed: 'fianto refused the checkout parameters. The error passed to onError names the field.',
  url_insecure: 'success_url and cancel_url must be https URLs.',
  amount_or_price_required: 'Send either price_id, or amount and description.',
  amount_out_of_range: 'The amount is outside the range fianto accepts.',
  amount_not_allowed: 'A subscription checkout is priced by price_id alone: remove amount and description.',
  expires_at_out_of_range: 'expires_at is outside the range fianto accepts.',
  mode_not_supported: 'This checkout mode is not available.',
  price_id_required: 'A subscription checkout needs a price_id.',
  price_not_found: 'No price with that price_id belongs to this shop.',
  price_archived: 'That price is archived and cannot be sold.',
  product_archived: "That price's product is archived and cannot be sold.",
  price_not_recurring: 'A subscription checkout needs a recurring price.',
  price_type_mismatch: "That price's type does not fit this checkout mode.",
};

const FAILED = { error: { code: 'internal_error', message: 'Checkout could not be started.' } };

function relayed(code: string): string | undefined {
  return Object.hasOwn(RELAYED, code) ? RELAYED[code] : undefined;
}

/** The browser-facing response for an error thrown while starting a checkout. */
export function checkoutErrorResponse(error: unknown): Response {
  if (isFiantoError(error, 'order_session_mismatch')) {
    return json(409, { error: { code: error.code, message: relayed(error.code) } });
  }
  if (isAPIError(error) && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403) {
    const message = relayed(error.code);
    if (message !== undefined) {
      const retryAfter = error.headers.get('retry-after');
      return json(error.status, { error: { code: error.code, message } }, retryAfter ? { 'retry-after': retryAfter } : {});
    }
  }
  return json(500, FAILED);
}
