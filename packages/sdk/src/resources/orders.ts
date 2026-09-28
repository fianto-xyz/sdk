import { pathId } from '../core/ids.js';
import { assertNotRequestOptions } from '../core/params.js';
import { PagePromise, stringifyCursor } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Order, OrderListParams } from '../types.js';

export class Orders {
  constructor(private readonly transport: Transport) {}

  /** `params` is reserved for a future filter/field (F6): none exists yet. */
  async retrieve(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<Order> {
    assertNotRequestOptions(params, 'orders.retrieve');
    return this.transport.request({ method: 'GET', path: `/v1/orders/${pathId(id)}`, query: { ...params } }, options);
  }

  /** By your own `order_id`. */
  retrieveByOrderId(orderId: string, options?: RequestOptions): Promise<Order> {
    return this.transport.request({ method: 'GET', path: '/v1/orders/lookup', query: { order_id: orderId } }, options);
  }

  list(params: OrderListParams = {}, options?: RequestOptions): PagePromise<Order> {
    assertNotRequestOptions(params, 'orders.list');
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<{ items: Order[]; next_cursor: number | null }>(
        { method: 'GET', path: '/v1/orders', query: { ...filters, cursor: next } },
        options,
      ).then(stringifyCursor),
      cursor,
    );
  }
}
