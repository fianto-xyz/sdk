import { pathId } from '../core/ids.js';
import { assertNotRequestOptions } from '../core/params.js';
import { PagePromise, stringifyCursor } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Payment, PaymentListParams } from '../types.js';

export class Payments {
  constructor(private readonly transport: Transport) {}

  /** `params` is reserved for a future filter/field (F6): none exists yet. */
  async retrieve(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<Payment> {
    assertNotRequestOptions(params, 'payments.retrieve');
    return this.transport.request({ method: 'GET', path: `/v1/payments/${pathId(id)}`, query: { ...params } }, options);
  }

  list(params: PaymentListParams = {}, options?: RequestOptions): PagePromise<Payment> {
    assertNotRequestOptions(params, 'payments.list');
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<{ items: Payment[]; next_cursor: number | null }>(
        { method: 'GET', path: '/v1/payments', query: { ...filters, cursor: next } },
        options,
      ).then(stringifyCursor),
      cursor,
    );
  }
}
