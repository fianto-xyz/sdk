import { Webhooks } from '@fianto/nextjs';
import { subscribeEnded } from '../../../../src/subscribe-attempts.js';

// Delivery is at-least-once and unordered: every callback below WILL be called more than once
// for the same event.id, and may run before or after other events for the same subscription.
// Dedupe on event.id inside the SAME database transaction as the write it guards — see
// @fianto/sdk's README ("Dedupe in the same transaction as the side effect") — instead of
// granting or revoking access here directly. This example only logs.
export const POST = Webhooks({
  secret: process.env.FIANTO_WEBHOOK_SECRET,
  // This example's checkout is a subscription: it creates no order, so its proof of payment
  // is subscription.created, never order.paid.
  onSubscriptionCreated: async (event) => {
    // Grant access for the first period.
    console.log('subscription created', event.data.id, event.data.order_id);
  },
  onSubscriptionRenewed: async (event) => {
    // Extend access by one period.
    console.log('subscription renewed', event.data.id);
  },
  onSubscriptionPastDue: async (event) => {
    // A renewal could not be charged: start dunning (tell the user, keep or pause access).
    console.log('subscription past due', event.data.id);
  },
  onSubscriptionEnded: async (event) => {
    // Revoke access. event.data.end_reason says why.
    console.log('subscription ended', event.data.id, event.data.end_reason);
    // Only now may this user subscribe to the plan again, under a new order_id (see
    // src/subscribe-attempts.ts).
    subscribeEnded(event.data.order_id);
  },
  // Covers mode: 'payment' checkouts only (none in this example): a subscription creates no order.
  onOrderPaid: async (event) => {
    console.log('order paid', event.data.order_id);
  },
  onEvent: async (event) => {
    console.log('fianto event', event.type);
  },
});
