import { pathId } from '../core/ids.js';
import { PagePromise } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Page, Subscription, SubscriptionCancelParams, SubscriptionListParams } from '../types.js';

export class Subscriptions {
  constructor(private readonly transport: Transport) {}

  retrieve(id: string, options?: RequestOptions): Promise<Subscription> {
    return this.transport.request({ method: 'GET', path: `/v1/subscriptions/${pathId(id)}` }, options);
  }

  list(params: SubscriptionListParams = {}, options?: RequestOptions): PagePromise<Subscription, number> {
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<Page<Subscription, number>>(
        { method: 'GET', path: '/v1/subscriptions', query: { ...filters, cursor: next } },
        options,
      ),
      cursor,
    );
  }

  cancel(id: string, params: SubscriptionCancelParams, options?: RequestOptions): Promise<Subscription> {
    return this.transport.request({ method: 'POST', path: `/v1/subscriptions/${pathId(id)}/cancel`, body: params }, options);
  }
}
