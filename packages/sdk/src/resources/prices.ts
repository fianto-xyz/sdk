import { pathId } from '../core/ids.js';
import { PagePromise } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Page, Price, PriceListParams } from '../types.js';

export class Prices {
  constructor(private readonly transport: Transport) {}

  retrieve(id: string, options?: RequestOptions): Promise<Price> {
    return this.transport.request({ method: 'GET', path: `/v1/prices/${pathId(id)}` }, options);
  }

  list(params: PriceListParams = {}, options?: RequestOptions): PagePromise<Price, number> {
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<Page<Price, number>>(
        { method: 'GET', path: '/v1/prices', query: { ...filters, cursor: next } },
        options,
      ),
      cursor,
    );
  }
}
