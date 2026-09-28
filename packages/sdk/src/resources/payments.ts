import { pathId } from '../core/ids.js';
import { PagePromise } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Page, Payment, PaymentListParams } from '../types.js';

export class Payments {
  constructor(private readonly transport: Transport) {}

  async retrieve(id: string, options?: RequestOptions): Promise<Payment> {
    return this.transport.request({ method: 'GET', path: `/v1/payments/${pathId(id)}` }, options);
  }

  list(params: PaymentListParams = {}, options?: RequestOptions): PagePromise<Payment, number> {
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<Page<Payment, number>>(
        { method: 'GET', path: '/v1/payments', query: { ...filters, cursor: next } },
        options,
      ),
      cursor,
    );
  }
}
