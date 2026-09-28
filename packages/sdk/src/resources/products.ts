import { pathId } from '../core/ids.js';
import { PagePromise } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Page, Product, ProductListParams } from '../types.js';

export class Products {
  constructor(private readonly transport: Transport) {}

  retrieve(id: string, options?: RequestOptions): Promise<Product> {
    return this.transport.request({ method: 'GET', path: `/v1/products/${pathId(id)}` }, options);
  }

  list(params: ProductListParams = {}, options?: RequestOptions): PagePromise<Product, number> {
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<Page<Product, number>>(
        { method: 'GET', path: '/v1/products', query: { ...filters, cursor: next } },
        options,
      ),
      cursor,
    );
  }
}
