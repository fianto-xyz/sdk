import { Fianto } from '../client.js';
import type { CheckoutSessionCreateParams } from '../types.js';
import { checkoutErrorResponse } from './relay.js';
import { json, report } from './respond.js';
import { OrderSessionMismatchError, mismatchedFields } from './session-match.js';

// The ordinary (non-distributive) `Omit` collapses `CheckoutSessionCreateParams`'s
// price_id/amount+description union into one object type where both are optional, losing the
// mutual exclusivity A1 added. Distributing over the union first (`T extends unknown ? … :
// never`, applied member-by-member) keeps each branch's own `?: never` intact.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type CheckoutSessionParams = DistributiveOmit<CheckoutSessionCreateParams, 'ui_mode'>;

/**
 * `Context` is whatever the framework adapter passes along with the request (Express:
 * `{ req, res }`, Hono: the `Context`, Next.js: the route context); `unknown` when the handler is
 * used directly.
 */
export interface CheckoutHandlerOptions<Context = unknown> {
  /** Default: new Fianto() from FIANTO_* env vars, created on the first request. */
  fianto?: Fianto;
  /**
   * Decide price and order_id HERE, on your server. Never take a price from the request body.
   * Return a Response to refuse. An order_id that already has an open checkout with different
   * terms is refused with 409 `order_session_mismatch`: give changed terms a new order_id (for
   * example, include a cart version).
   */
  createSession: (request: Request, context: Context) => Promise<CheckoutSessionParams | Response>;
  /** Origins allowed to call this route. Default: the request URL's own origin. */
  allowedOrigins?: readonly string[];
  /**
   * Called with the original error for every failure, including errors relayed to the browser
   * and the ones hidden behind a generic 500 (credentials, 5xx, unlisted codes). A throwing
   * `onError` never changes the response.
   */
  onError?: (error: unknown) => void;
}

/** The handler's context argument: optional only while `undefined` fits `Context`. */
export type CheckoutContextArgs<Context> = undefined extends Context ? [context?: Context] : [context: Context];

function sameSite(request: Request, allowed: readonly string[] | undefined): boolean {
  if (request.headers.get('sec-fetch-site') === 'same-origin') return true;
  const origin = request.headers.get('origin');
  return origin !== null && (allowed ?? [new URL(request.url).origin]).includes(origin);
}

/**
 * The server route behind openCheckout() / <fianto-button>: creates a popup-mode session and
 * answers { id, url }. When the order already has an open session with the same terms it
 * reissues that session's link; with different terms it answers 409 `order_session_mismatch`
 * and leaves the open session alone.
 *
 * Errors reach the browser as `{ error: { code, message } }` only for an allowlisted set of codes
 * (with SDK-written messages, and `retry-after` passed through — a 429 is `rate_limited`);
 * anything else is a generic 500 `internal_error`.
 */
export function createCheckoutHandler<Context = unknown>(
  options: CheckoutHandlerOptions<Context>,
): (request: Request, ...context: CheckoutContextArgs<Context>) => Promise<Response> {
  let client = options.fianto;
  return async (request, ...rest) => {
    if (request.method !== 'POST') return json(405, { error: { code: 'method_not_allowed', message: 'Use POST.' } }, { allow: 'POST' });
    if (!sameSite(request, options.allowedOrigins)) {
      return json(403, { error: { code: 'forbidden_origin', message: 'This checkout route only accepts requests from its own site.' } });
    }
    try {
      const params = await options.createSession(request, rest[0] as Context);
      if (params instanceof Response) return params;
      client ??= new Fianto();
      const sent: CheckoutSessionCreateParams = { ...params, ui_mode: 'popup' };
      let session = await client.checkoutSessions.create(sent);
      if (session.url === null) {
        // The order already has an OPEN session: reuse it only if it is for exactly these terms.
        const fields = await mismatchedFields(client, sent, session);
        if (fields.length > 0) throw new OrderSessionMismatchError(session.id, fields, sent.order_id);
        session = await client.checkoutSessions.reissueLink(session.id);
      }
      return json(200, { id: session.id, url: session.url });
    } catch (error) {
      report(() => options.onError?.(error));
      return checkoutErrorResponse(error);
    }
  };
}
