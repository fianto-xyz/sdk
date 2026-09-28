import { pathId } from '../core/ids.js';
import { assertNotRequestOptions } from '../core/params.js';
import { PagePromise, stringifyCursor } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Price, PriceListParams } from '../types.js';

export class Prices {
  constructor(private readonly transport: Transport) {}

  /** `params` is reserved for a future filter/field (F6): none exists yet. */
  async retrieve(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<Price> {
    assertNotRequestOptions(params, 'prices.retrieve');
    return this.transport.request({ method: 'GET', path: `/v1/prices/${pathId(id)}`, query: { ...params } }, options);
  }

  list(params: PriceListParams = {}, options?: RequestOptions): PagePromise<Price> {
    assertNotRequestOptions(params, 'prices.list');
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<{ items: Price[]; next_cursor: number | null }>(
        { method: 'GET', path: '/v1/prices', query: { ...filters, cursor: next } },
        options,
      ).then(stringifyCursor),
      cursor,
    );
  }
}
