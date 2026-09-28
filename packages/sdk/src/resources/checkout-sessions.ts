import { pathId } from '../core/ids.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { CheckoutSession, CheckoutSessionCreateParams } from '../types.js';

export class CheckoutSessions {
  constructor(private readonly transport: Transport) {}

  /** The response's `url` is the only copy of the payment link. A retry under the same idempotency key returns it again. */
  create(params: CheckoutSessionCreateParams, options?: RequestOptions): Promise<CheckoutSession> {
    return this.transport.request({ method: 'POST', path: '/v1/checkout-sessions', body: params }, options);
  }

  retrieve(id: string, options?: RequestOptions): Promise<CheckoutSession> {
    return this.transport.request({ method: 'GET', path: `/v1/checkout-sessions/${pathId(id)}` }, options);
  }

  cancel(id: string, options?: RequestOptions): Promise<CheckoutSession> {
    return this.transport.request({ method: 'POST', path: `/v1/checkout-sessions/${pathId(id)}/cancel` }, options);
  }

  /** A new `url` for an OPEN session; the old link stops working. 409 `payment_in_progress` / `session_not_reissuable` when it cannot. */
  reissueLink(id: string, options?: RequestOptions): Promise<CheckoutSession> {
    return this.transport.request({ method: 'POST', path: `/v1/checkout-sessions/${pathId(id)}/link` }, options);
  }
}
