import { isAPIError, isFiantoError } from '../core/errors.js';
import { json } from './respond.js';
import { OpenSessionPriceEndedError } from './session-match.js';

/**
 * The only error codes `createCheckoutHandler` relays to the browser, each with the SDK's own
 * message (never the API's wording): what a payer-facing UI can act on, plus validation codes
 * for the merchant's own params so a misconfigured route is visible in development. Everything
 * else (any other code, every other 5xx, and 401/403, which are credential errors) becomes a
 * generic 500. The original error always goes to `onError`.
 */
const RELAYED: Readonly<Record<string, string>> = {
  // The payer can act on these (wait, retry, or stop).
  // Also answered when no payment exists yet but the last built transaction could still land.
  payment_in_progress: 'A payment for this order may already be in progress. Wait a minute before trying again.',
  order_already_paid: 'This order has already been paid.',
  // A COMPLETED subscription checkout keeps its order_id: a new subscribe needs a new one.
  order_id_in_use: 'This order has already been checked out. Start a new order.',
  checkout_unavailable: 'Checkout is unavailable right now. Try again in a moment.',
  rate_limited: 'Too many checkout attempts. Try again in a moment.',
  session_not_reissuable: 'The open checkout for this order can no longer be reopened. Try again in a few minutes.',
  plan_limit_reached: 'This shop cannot start new subscriptions right now. Try again later.',
  order_session_mismatch:
    'This order already has an open checkout with different terms. Use a new order_id for the new terms ' +
    '(for example, include a cart version), or cancel the open checkout session first.',
  // 503s (see BUSY): nothing was started; the same request can succeed later.
  checkout_busy: 'Payments are very busy right now. Try again in a few seconds.',
  service_busy: 'Payments are very busy right now. Try again in a few seconds.',
  subscriptions_paused: 'New subscriptions are paused right now. Try again later.',
  // The merchant's own setup or checkout params were refused.
  merchant_token_account_missing: "This shop's wallet cannot receive USDC yet.",
  validation_failed: 'fianto refused the checkout parameters. The error passed to onError names the field.',
  url_insecure: 'success_url and cancel_url must be https URLs.',
  amount_or_price_required: 'Send either price_id, or amount and description.',
  amount_out_of_range: 'The amount is outside the range fianto accepts.',
  amount_not_allowed: 'A subscription checkout is priced by price_id alone: remove amount and description.',
  expires_at_out_of_range: 'expires_at is outside the range fianto accepts.',
  mode_not_supported: 'This checkout mode is not available.',
  price_id_required: 'A subscription checkout needs a price_id.',
  price_not_found: 'No price with that price_id belongs to this shop.',
  price_ended: 'That price has ended and cannot be sold.',
  product_ended: "That price's product has ended and cannot be sold.",
  price_not_recurring: 'A subscription checkout needs a recurring price.',
  price_type_mismatch: "That price's type does not fit this checkout mode.",
};

/** The only codes relayed with a 5xx status: the API's 503 answers that mean "busy, retry". */
const BUSY: ReadonlySet<string> = new Set(['checkout_busy', 'service_busy', 'subscriptions_paused']);

const FAILED = { error: { code: 'internal_error', message: 'Checkout could not be started.' } };

function relayed(code: string): string | undefined {
  return Object.hasOwn(RELAYED, code) ? RELAYED[code] : undefined;
}

function relayable(status: number, code: string): boolean {
  if (status === 503) return BUSY.has(code);
  return status >= 400 && status < 500 && status !== 401 && status !== 403;
}

/** The browser-facing response for an error thrown while starting a checkout. */
export function checkoutErrorResponse(error: unknown): Response {
  if (isFiantoError(error, 'order_session_mismatch')) {
    return json(409, { error: { code: error.code, message: relayed(error.code) } });
  }
  if (error instanceof OpenSessionPriceEndedError) {
    return json(422, { error: { code: error.code, message: relayed(error.code) } });
  }
  if (isAPIError(error) && relayable(error.status, error.code)) {
    const message = relayed(error.code);
    if (message !== undefined) {
      const retryAfter = error.headers.get('retry-after');
      return json(error.status, { error: { code: error.code, message } }, retryAfter ? { 'retry-after': retryAfter } : {});
    }
  }
  return json(500, FAILED);
}
