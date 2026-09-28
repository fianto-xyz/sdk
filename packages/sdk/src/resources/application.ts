import type { RequestOptions, Transport } from '../core/transport.js';
import type { Application } from '../types.js';

export class ApplicationResource {
  constructor(private readonly transport: Transport) {}

  /** `params` is reserved for a future filter/field (F6): none exists yet. */
  retrieve(params: Record<string, never> = {}, options?: RequestOptions): Promise<Application> {
    return this.transport.request({ method: 'GET', path: '/v1/application', query: { ...params } }, options);
  }
}
