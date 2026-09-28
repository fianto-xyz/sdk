import { pathId } from '../core/ids.js';
import { PagePromise } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Event, EventListParams, Page } from '../types.js';

export class Events {
  constructor(private readonly transport: Transport) {}

  async retrieve(id: string, options?: RequestOptions): Promise<Event> {
    return this.transport.request({ method: 'GET', path: `/v1/events/${pathId(id)}` }, options);
  }

  list(params: EventListParams = {}, options?: RequestOptions): PagePromise<Event, string> {
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<Page<Event, string>>(
        { method: 'GET', path: '/v1/events', query: { ...filters, cursor: next } },
        options,
      ),
      cursor,
    );
  }
}
