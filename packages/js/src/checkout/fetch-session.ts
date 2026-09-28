import { CheckoutSessionError } from './errors.js';
import { resolveSession, type CheckoutSession } from './session.js';

export interface FetchCheckoutSessionInit extends Omit<RequestInit, 'body' | 'method'> {
  /** Serialised as the JSON request body. Default `{}`. */
  body?: unknown;
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
}

/**
 * POSTs to your checkout route (built with `createCheckoutHandler` from `@fianto/sdk/handlers`,
 * or an adapter's `Checkout()`/`checkout()`) and returns its `{ id, url }`. A refusal rejects
 * with a `CheckoutSessionError` carrying the route's `code` (`payment_in_progress`,
 * `order_session_mismatch`, `rate_limited`, …), the HTTP `status` and `retryAfter`, so a 409
 * or 429 never turns into `invalid_session`.
 *
 * ```ts
 * openCheckout({ session: () => fetchCheckoutSession('/api/checkout', { body: { orderId } }) });
 * ```
 */
export async function fetchCheckoutSession(endpoint: string | URL, init: FetchCheckoutSessionInit = {}): Promise<CheckoutSession> {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await fetch(endpoint, {
      credentials: 'same-origin',
      ...init,
      method: 'POST',
      headers,
      body: JSON.stringify(init.body ?? {}),
    });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw new CheckoutSessionError('network_error', 'Could not reach your checkout route.');
  }
  // An aborted signal can also cut off the body read itself, after headers already came back
  // (the `fetch()` call above already resolved, so that catch never sees it). Swallowing THIS
  // rejection as "just a bad/empty body" would turn a real abort into a misleading
  // `session_request_failed` instead of the caller's own abort error.
  const body = (await response.json().catch((cause: unknown) => {
    if (init.signal?.aborted) throw cause;
    return null;
  })) as { error?: { code?: unknown; message?: unknown } } | null;
  if (!response.ok) {
    const code = body?.error?.code;
    const message = body?.error?.message;
    throw new CheckoutSessionError(
      typeof code === 'string' ? code : 'session_request_failed',
      typeof message === 'string' ? message : `Your checkout route answered ${response.status}.`,
      response.status,
      retryAfterSeconds(response.headers.get('retry-after')),
    );
  }
  const { id, url } = await resolveSession(body as CheckoutSession);
  return { id, url };
}
