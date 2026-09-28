import { Webhooks } from '@fianto/nextjs';

export const POST = Webhooks({
  secret: process.env.FIANTO_WEBHOOK_SECRET,
  onOrderPaid: async (event) => {
    // Delivery is at-least-once and unordered: this callback WILL be called more than once
    // for the same event.id, and may run before/after other events for the same order.
    // Dedupe on event.id inside the SAME database transaction as the fulfilment write — see
    // @fianto/sdk's README ("Dedupe in the same transaction as the side effect") — instead of
    // fulfilling here directly.
    console.log('order paid', event.data.order_id);
  },
  onSubscriptionRenewed: async (event) => {
    // Same idempotency requirement as above: dedupe on event.id before extending access.
    console.log('subscription renewed', event.data.id);
  },
  onEvent: async (event) => {
    console.log('fianto event', event.type);
  },
});
