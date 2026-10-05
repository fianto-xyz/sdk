import { assertNotRequestOptions, bodyOf } from '../core/params.js';
import { pathId } from '../core/ids.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { CheckoutSession, CheckoutSessionCreateParams } from '../types.js';

export class CheckoutSessions {
  constructor(private readonly transport: Transport) {}

  /**
   * For a new session, the response's `url` is the only copy of the payment link. `url` is
   * null when `order_id` already has an OPEN session: that session is returned unchanged. Call
   * `reissueLink(session.id)` for a new link to it, or use a new `order_id` for different terms.
   * A retry under the same idempotency key returns the original response, `url` included.
   */
  create(params: CheckoutSessionCreateParams, options?: RequestOptions): Promise<CheckoutSession> {
    assertNotRequestOptions(params, 'checkoutSessions.create');
    return this.transport.request({ method: 'POST', path: '/v1/checkout-sessions', body: params }, options);
  }

  /** `params` is reserved for a future filter/field (F6): none exists yet. */
  async retrieve(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<CheckoutSession> {
    assertNotRequestOptions(params, 'checkoutSessions.retrieve');
    return this.transport.request({ method: 'GET', path: `/v1/checkout-sessions/${pathId(id)}`, query: { ...params } }, options);
  }

  /** `params` is reserved for a future body field (F6): none exists yet. */
  async cancel(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<CheckoutSession> {
    assertNotRequestOptions(params, 'checkoutSessions.cancel');
    return this.transport.request({ method: 'POST', path: `/v1/checkout-sessions/${pathId(id)}/cancel`, body: bodyOf(params) }, options);
  }

  /**
   * A new `url` for an OPEN session; the old link stops working. Refusals:
   * - 409 `session_not_reissuable`: the session is not OPEN, or expires in under 2 minutes.
   * - 409 `payment_in_progress`: a payment is live, the last transaction built for the
   *   session could still land, or another request (a build, submit or cancel) held the
   *   session past the lock timeout.
   * - 409 `checkout_unavailable` with `Retry-After`: the chain could not be read (retried
   *   automatically).
   * - 503 `checkout_busy` with `Retry-After`: fianto was too busy to start (retried
   *   automatically).
   *
   * The link is reissued even when the session's price has since ended; check the price first
   * if that matters (`createCheckoutHandler` does). `params` is reserved for a future body
   * field (F6): none exists yet.
   */
  async reissueLink(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<CheckoutSession> {
    assertNotRequestOptions(params, 'checkoutSessions.reissueLink');
    return this.transport.request({ method: 'POST', path: `/v1/checkout-sessions/${pathId(id)}/link`, body: bodyOf(params) }, options);
  }
}
