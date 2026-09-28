import { pathId } from '../core/ids.js';
import { PagePromise, stringifyCursor } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Product, ProductListParams } from '../types.js';

export class Products {
  constructor(private readonly transport: Transport) {}

  /** `params` is reserved for a future filter/field (F6): none exists yet. */
  async retrieve(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<Product> {
    return this.transport.request({ method: 'GET', path: `/v1/products/${pathId(id)}`, query: { ...params } }, options);
  }

  list(params: ProductListParams = {}, options?: RequestOptions): PagePromise<Product, string> {
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<{ items: Product[]; next_cursor: number | null }>(
        { method: 'GET', path: '/v1/products', query: { ...filters, cursor: next } },
        options,
      ).then(stringifyCursor),
      cursor,
    );
  }
}
