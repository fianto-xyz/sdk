import { Fianto } from '../client.js';
import { isAPIError } from '../core/errors.js';
import type { CheckoutSessionCreateParams } from '../types.js';
import { json } from './respond.js';

// The ordinary (non-distributive) `Omit` collapses `CheckoutSessionCreateParams`'s
// price_id/amount+description union into one object type where both are optional, losing the
// mutual exclusivity A1 added. Distributing over the union first (`T extends unknown ? … :
// never`, applied member-by-member) keeps each branch's own `?: never` intact.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type CheckoutSessionParams = DistributiveOmit<CheckoutSessionCreateParams, 'ui_mode'>;

export interface CheckoutHandlerOptions {
  /** Default: new Fianto() from FIANTO_* env vars, created on the first request. */
  fianto?: Fianto;
  /** Decide price and order_id HERE, on your server. Never take a price from the request body. Return a Response to refuse. */
  createSession: (request: Request) => Promise<CheckoutSessionParams | Response>;
  /** Origins allowed to call this route. Default: the request URL's own origin. */
  allowedOrigins?: readonly string[];
  /** Called for every error, including API errors passed through to the browser. */
  onError?: (error: unknown) => void;
}

const FAILED = { error: { code: 'internal_error', message: 'Checkout could not be started.' } };

function sameSite(request: Request, allowed: readonly string[] | undefined): boolean {
  if (request.headers.get('sec-fetch-site') === 'same-origin') return true;
  const origin = request.headers.get('origin');
  return origin !== null && (allowed ?? [new URL(request.url).origin]).includes(origin);
}

/**
 * The server route behind openCheckout() / <fianto-button>: creates a popup-mode session and
 * answers { id, url }. When the order already has an open session it reissues that session's link.
 */
export function createCheckoutHandler(options: CheckoutHandlerOptions): (request: Request) => Promise<Response> {
  let client = options.fianto;
  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: { code: 'method_not_allowed', message: 'Use POST.' } }, { allow: 'POST' });
    if (!sameSite(request, options.allowedOrigins)) {
      return json(403, { error: { code: 'forbidden_origin', message: 'This checkout route only accepts requests from its own site.' } });
    }
    try {
      const params = await options.createSession(request);
      if (params instanceof Response) return params;
      client ??= new Fianto();
      let session = await client.checkoutSessions.create({ ...params, ui_mode: 'popup' });
      if (session.url === null) session = await client.checkoutSessions.reissueLink(session.id);
      return json(200, { id: session.id, url: session.url });
    } catch (error) {
      options.onError?.(error);
      if (isAPIError(error) && error.status !== 401 && error.status !== 403) {
        const retryAfter = error.headers.get('retry-after');
        return json(error.status, { error: { code: error.code, message: error.message } }, retryAfter ? { 'retry-after': retryAfter } : {});
      }
      return json(500, FAILED);
    }
  };
}
