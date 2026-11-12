// Type-level checks only — see `../core/errors.test-d.ts` for why this is a `*.test-d.ts` file
// (compiled by `tsc -p tsconfig.json` under `pnpm typecheck`, never run by vitest).
//
// F1: `switch (event.type)` over what `verifyWebhook` returns must narrow `event.data` with no
// cast. F2: `event.id` must type-check once the URL probe (which has no id) is ruled out.
import { expectTypeOf } from 'vitest';
import type { PaymentCard } from '../types.js';
import {
  isKnownEventType, refundDelta, sampleEvent, verifyWebhook,
  type FiantoWebhookEvent, type PaymentDisputedEvent, type PaymentRefundedEvent, type UnknownWebhookEvent, type WebhookEvent,
  type WebhookEventMap, type WebhookEventOf, type WebhookEventType,
} from './index.js';

declare const rawBody: string;
declare const headers: Headers;

export async function narrowsTheVerifiedEvent(): Promise<void> {
  const event = await verifyWebhook(rawBody, headers);
  expectTypeOf(event).toEqualTypeOf<WebhookEvent>();
  switch (event.type) {
    case 'order.paid':
      expectTypeOf(event.data.order_id).toEqualTypeOf<string>();
      // Absent on events created before one-time payments carried the network fee (October 2026): optional.
      expectTypeOf(event.data.network_fee_amount).toEqualTypeOf<string | undefined>();
      expectTypeOf(event.id).toEqualTypeOf<string>();
      break;
    case 'subscription.renewed':
      expectTypeOf(event.data.current_period_index).toEqualTypeOf<number>();
      // Absent on events created before the renewal network fee (October 2026): optional.
      expectTypeOf(event.data.network_fee_amount).toEqualTypeOf<string | undefined>();
      expectTypeOf(event.data.total_amount).toEqualTypeOf<string>();
      break;
    case 'checkout.session.completed':
      expectTypeOf(event.data.network_fee_amount).toEqualTypeOf<string | undefined>();
      break;
    case 'endpoint.verification':
      expectTypeOf(event.data.challenge).toEqualTypeOf<string>();
      // @ts-expect-error the URL probe carries no id.
      void event.id;
      break;
    default:
      // Every business event has an id; only the probe (handled above) does not.
      expectTypeOf(event.id).toEqualTypeOf<string>();
  }
}

export async function idAfterRulingOutTheProbe(): Promise<void> {
  const event = await verifyWebhook(rawBody, headers);
  if (event.type === 'endpoint.verification') return;
  expectTypeOf(event).toEqualTypeOf<FiantoWebhookEvent>();
  expectTypeOf(event.id).toEqualTypeOf<string>();
}

declare const type: string;
if (isKnownEventType(type)) {
  expectTypeOf(type).toEqualTypeOf<WebhookEventType>();
}

// Kept for defensive code that handles types newer than this SDK.
declare const unknownEvent: UnknownWebhookEvent;
expectTypeOf(unknownEvent.data).toEqualTypeOf<unknown>();

// Card payments (November 2026): the payment says how it was paid, and an event stored before
// then has no `gateway`/`method` at all, which reads as crypto.
declare const orderPaid: WebhookEventOf<'order.paid'>;

export function narrowsAnOldOrderEventWithNoMethodAsCrypto(): void {
  const payment = orderPaid.data.payment;
  if (payment.method === undefined && payment.id !== null) {
    expectTypeOf(payment.signature).toEqualTypeOf<string>();
    expectTypeOf(payment.gateway).toEqualTypeOf<'solana' | undefined>();
  }
  if (payment.method !== 'card' && payment.id !== null) {
    expectTypeOf(payment.signature).toEqualTypeOf<string>();
  }
  if (payment.method === 'card') {
    expectTypeOf(payment.signature).toEqualTypeOf<null>();
    expectTypeOf(payment.gateway).toEqualTypeOf<'stripe'>();
  }
  if (payment.id === null) {
    expectTypeOf(payment.signature).toEqualTypeOf<null>();
    expectTypeOf(payment.method).toEqualTypeOf<null | undefined>();
  }
  // The order's currency is not narrowed by the payment (the spec union stays).
  expectTypeOf(orderPaid.data.currency).toEqualTypeOf<'USDC' | 'USD'>();
}

// An old event's payment with no gateway or method is still a valid crypto payment.
const oldPayment: WebhookEventMap['order.paid']['payment'] = { id: 'fian_pay_1', signature: 'sig' };
void oldPayment;
// @ts-expect-error a card payment has no signature.
const cardWithSignature: WebhookEventMap['order.paid']['payment'] = { id: 'fian_pay_1', signature: 'sig', gateway: 'stripe', method: 'card' };
void cardWithSignature;
// @ts-expect-error a crypto payment always has its signature.
const cryptoWithoutSignature: WebhookEventMap['order.paid']['payment'] = { id: 'fian_pay_1', signature: null, gateway: 'solana', method: 'crypto' };
void cryptoWithoutSignature;

declare const sessionCompleted: WebhookEventOf<'checkout.session.completed'>;
export function narrowsTheSessionEventPayment(): void {
  const payment = sessionCompleted.data.payment;
  if (payment.method === 'card') {
    expectTypeOf(payment.signature).toEqualTypeOf<null>();
    expectTypeOf(payment.status).toEqualTypeOf<'PROCESSING' | 'CONFIRMED' | 'SUCCEEDED' | 'FAILED' | undefined>();
  }
  // The session event keeps the all-null payment (the v1 session has `payment: null` instead).
  if (payment.id === null) expectTypeOf(payment.status).toEqualTypeOf<null | undefined>();
}

declare const subscriptionRenewed: WebhookEventOf<'subscription.renewed'>;
export function narrowsTheSubscriptionEventByMethod(): void {
  const data = subscriptionRenewed.data;
  if (data.method === 'card') {
    expectTypeOf(data.currency).toEqualTypeOf<'USD'>();
    expectTypeOf(data.customer.wallet).toEqualTypeOf<null>();
    expectTypeOf(data.card).toEqualTypeOf<PaymentCard | null>();
  } else {
    // `method` is absent on an event stored before card subscriptions: still crypto.
    expectTypeOf(data.method).toEqualTypeOf<'crypto' | undefined>();
    expectTypeOf(data.currency).toEqualTypeOf<'USDC'>();
    expectTypeOf(data.customer.wallet).toEqualTypeOf<string>();
  }
}

declare const duplicate: WebhookEventOf<'order.duplicate_payment'>;
export function narrowsTheDuplicate(): void {
  if (duplicate.data.duplicate.gateway === 'stripe') expectTypeOf(duplicate.data.duplicate.signature).toEqualTypeOf<null>();
  else expectTypeOf(duplicate.data.duplicate.signature).toEqualTypeOf<string>();
}

declare const refunded: WebhookEventOf<'payment.refunded'>;
declare const disputed: WebhookEventOf<'payment.disputed'>;
export function typesTheRefundAndDisputeEvents(): void {
  expectTypeOf(refunded.data).toEqualTypeOf<PaymentRefundedEvent>();
  expectTypeOf(refunded.data.refund.status).toEqualTypeOf<'succeeded' | 'dispute_lost' | 'failed' | 'reversed'>();
  expectTypeOf(refunded.data.refund.applied_amount).toEqualTypeOf<string>();
  expectTypeOf(refundDelta(refunded.data)).toEqualTypeOf<bigint>();
  if (refunded.data.payment.method === 'crypto') expectTypeOf(refunded.data.payment.signature).toEqualTypeOf<string>();
  // The event's payment is the v1 payment without `network` (the envelope carries it).
  // @ts-expect-error no network inside the event's payment.
  void refunded.data.payment.network;
  expectTypeOf(disputed.data).toEqualTypeOf<PaymentDisputedEvent>();
  expectTypeOf(disputed.data.payment.method).toEqualTypeOf<'card'>();
  expectTypeOf(disputed.data.dispute.status).toEqualTypeOf<'needs_response' | 'under_review' | 'won' | 'lost' | 'accepted' | 'closed'>();
}

declare const invoicePaid: WebhookEventOf<'invoice.paid'>;
declare const recorded: WebhookEventOf<'invoice.payment_recorded'>;
declare const creditNote: WebhookEventOf<'credit_note.issued'>;
expectTypeOf(invoicePaid.data.total).toEqualTypeOf<string>();
expectTypeOf(creditNote.data.kind).toEqualTypeOf<'invoice' | 'credit_note'>();
expectTypeOf(recorded.data.external_payment_id).toEqualTypeOf<string>();

// sampleEvent's `method` is offered only where the event has that form.
sampleEvent('order.paid', { method: 'card' });
sampleEvent('payment.disputed', { method: 'card' });
// @ts-expect-error a dispute is card only.
sampleEvent('payment.disputed', { method: 'crypto' });
// @ts-expect-error test.event has no payment method.
sampleEvent('test.event', { method: 'card' });
// @ts-expect-error not a payment method.
sampleEvent('order.paid', { method: 'paypal' });
declare const anyType: WebhookEventType;
sampleEvent(anyType, { method: 'card' });

// The way to branch on the rail: `method === 'card'`, then `else` for crypto. Never test
// `=== 'crypto'`: an event stored before card payments has no `method` key at all, and such a
// payment is crypto, so it would fall through both branches.
export function branchesOnCardThenElse(): void {
  const payment = orderPaid.data.payment;
  if (payment.id === null) return;
  if (payment.method === 'card') {
    expectTypeOf(payment.signature).toEqualTypeOf<null>();
  } else {
    // Crypto, including an old event with no method key.
    expectTypeOf(payment.signature).toEqualTypeOf<string>();
    expectTypeOf(payment.method).toEqualTypeOf<'crypto' | undefined>();
  }
}
