import type { RequestOptions, Transport } from '../core/transport.js';
import type { Application } from '../types.js';

export class ApplicationResource {
  constructor(private readonly transport: Transport) {}

  retrieve(options?: RequestOptions): Promise<Application> {
    return this.transport.request({ method: 'GET', path: '/v1/application' }, options);
  }
}
