import { assertNotRequestOptions, bodyOf } from '../core/params.js';
import { pathId } from '../core/ids.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { CheckoutSession, CheckoutSessionCreateParams } from '../types.js';

export class CheckoutSessions {
  constructor(private readonly transport: Transport) {}

  /** The response's `url` is the only copy of the payment link. A retry under the same idempotency key returns it again. */
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
   * A new `url` for an OPEN session; the old link stops working. 409 `payment_in_progress` /
   * `session_not_reissuable` when it cannot. `params` is reserved for a future body field (F6):
   * none exists yet.
   */
  async reissueLink(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<CheckoutSession> {
    assertNotRequestOptions(params, 'checkoutSessions.reissueLink');
    return this.transport.request({ method: 'POST', path: `/v1/checkout-sessions/${pathId(id)}/link`, body: bodyOf(params) }, options);
  }
}
