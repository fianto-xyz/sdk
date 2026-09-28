import { pathId } from '../core/ids.js';
import { PagePromise } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Order, OrderListParams, Page } from '../types.js';

export class Orders {
  constructor(private readonly transport: Transport) {}

  async retrieve(id: string, options?: RequestOptions): Promise<Order> {
    return this.transport.request({ method: 'GET', path: `/v1/orders/${pathId(id)}` }, options);
  }

  /** By your own `order_id`. */
  retrieveByOrderId(orderId: string, options?: RequestOptions): Promise<Order> {
    return this.transport.request({ method: 'GET', path: '/v1/orders/lookup', query: { order_id: orderId } }, options);
  }

  list(params: OrderListParams = {}, options?: RequestOptions): PagePromise<Order, number> {
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<Page<Order, number>>(
        { method: 'GET', path: '/v1/orders', query: { ...filters, cursor: next } },
        options,
      ),
      cursor,
    );
  }
}
