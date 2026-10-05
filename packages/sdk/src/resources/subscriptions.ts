import { pathId } from '../core/ids.js';
import { assertNotRequestOptions } from '../core/params.js';
import { PagePromise, stringifyCursor } from '../core/pagination.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { Subscription, SubscriptionCancelParams, SubscriptionListParams } from '../types.js';

export class Subscriptions {
  constructor(private readonly transport: Transport) {}

  /** `params` is reserved for a future filter/field (F6): none exists yet. */
  async retrieve(id: string, params: Record<string, never> = {}, options?: RequestOptions): Promise<Subscription> {
    assertNotRequestOptions(params, 'subscriptions.retrieve');
    return this.transport.request({ method: 'GET', path: `/v1/subscriptions/${pathId(id)}`, query: { ...params } }, options);
  }

  list(params: SubscriptionListParams = {}, options?: RequestOptions): PagePromise<Subscription> {
    assertNotRequestOptions(params, 'subscriptions.list');
    const { cursor, ...filters } = params;
    return new PagePromise(
      (next) => this.transport.request<{ items: Subscription[]; next_cursor: number | null }>(
        { method: 'GET', path: '/v1/subscriptions', query: { ...filters, cursor: next } },
        options,
      ).then(stringifyCursor),
      cursor,
    );
  }

  /**
   * `at: 'period_end'` schedules the end at `current_period_end` and sends
   * `subscription.cancel_scheduled`, unless a cancel is already scheduled: asking twice changes
   * nothing, and behind a payer's own cancel the payer's stands with no new event. Your cancel is
   * still recorded (`merchant_cancel_requested: true`): if the payer then resumes, it takes over
   * (ending at `current_period_end`), announced by a second `subscription.cancel_scheduled` with
   * `cancel_reason: MERCHANT_CANCELED`.
   *
   * `at: 'now'` ends it at once (`subscription.ended`, `end_reason: MERCHANT_CANCELED`) and clears
   * any scheduled cancel. A renewal charge already in flight is not stopped and can still land
   * after that; fianto flags it to the merchant for a refund decision.
   * Refusals: 409 `subscription_already_ended`; 503 `subscription_busy` (nothing changed;
   * retried automatically).
   */
  async cancel(id: string, params: SubscriptionCancelParams, options?: RequestOptions): Promise<Subscription> {
    assertNotRequestOptions(params, 'subscriptions.cancel');
    return this.transport.request({ method: 'POST', path: `/v1/subscriptions/${pathId(id)}/cancel`, body: params }, options);
  }
}
