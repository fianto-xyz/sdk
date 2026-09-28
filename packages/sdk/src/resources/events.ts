import { pathId } from '../core/ids.js';
import { PagePromise } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { EventListParams, FiantoEvent, Page } from '../types.js';

export class Events {
  constructor(private readonly transport: Transport) {}

  /** `params` is reserved for a future filter/field (F6): none exists yet. */
  async retrieve(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<FiantoEvent> {
    return this.transport.request({ method: 'GET', path: `/v1/events/${pathId(id)}`, query: { ...params } }, options);
  }

  list(params: EventListParams = {}, options?: RequestOptions): PagePromise<FiantoEvent> {
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<Page<FiantoEvent>>(
        { method: 'GET', path: '/v1/events', query: { ...filters, cursor: next } },
        options,
      ),
      cursor,
    );
  }
}
