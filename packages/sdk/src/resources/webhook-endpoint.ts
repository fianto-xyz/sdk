import type { RequestOptions, Transport } from '../core/transport.js';
import type { TestEventResult } from '../types.js';

export class WebhookEndpoint {
  constructor(private readonly transport: Transport) {}

  /** fianto delivers a signed `test.event` to your verified endpoint. Shares the dashboard's 10/hour budget. */
  sendTestEvent(options?: RequestOptions): Promise<TestEventResult> {
    return this.transport.request({ method: 'POST', path: '/v1/webhook/test-event' }, options);
  }
}
