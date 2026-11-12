import { AmountError } from '../amounts.js';
import type { PaymentRefundedEvent } from './events.js';

const POSITIVE = /^[1-9]\d*$/;

/**
 * How much one `payment.refunded` event moved the payment's `refunded_amount`, in base units:
 * `+applied_amount` for `succeeded` and `dispute_lost`, `-applied_amount` for `failed` and
 * `reversed`.
 *
 * Keep a running total like this:
 * - seed it once from `GET /v1/payments/{id}` (`refunded_amount`);
 * - add `refundDelta(event.data)` once per event id (`event.id`), which is how you already
 *   dedupe deliveries. Never pair or dedupe by `refund.id`: one card refund can be two
 *   `succeeded` events with the same `refund.id`, and both count;
 * - never sum `refund.amount`, which can be more than the figure moved.
 *
 * The sum does not depend on the order the events arrive in. It is exact only when none of the
 * payment's events was in flight while the seed was read, so compare it with
 * `GET /v1/payments/{id}`, which always has the current figure.
 *
 * Throws `AmountError` when `applied_amount` is not a positive base-unit integer, or when
 * `refund.status` is a value this SDK version does not know: answering 500 lets fianto retry the
 * delivery once you have upgraded, rather than counting it with the wrong sign.
 */
export function refundDelta(data: PaymentRefundedEvent): bigint {
  const { status, applied_amount: applied } = data.refund;
  if (typeof applied !== 'string' || !POSITIVE.test(applied)) {
    throw new AmountError(`payment.refunded applied_amount is not a positive base-unit amount: ${JSON.stringify(applied)}`);
  }
  const amount = BigInt(applied);
  switch (status) {
    case 'succeeded':
    case 'dispute_lost':
      return amount;
    case 'failed':
    case 'reversed':
      return -amount;
    default:
      throw new AmountError(`Unknown payment.refunded refund status ${JSON.stringify(status satisfies never)}: upgrade @fianto/sdk.`);
  }
}
