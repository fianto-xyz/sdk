import type { EndpointVerificationEvent, WebhookEventMap, WebhookEventOf, WebhookEventType } from './events.js';

const AT = '2026-09-28T10:00:00.000Z';
const LATER = '2026-09-28T10:05:00.000Z';
const NEXT = '2026-10-28T10:00:00.000Z';
const EVENT_ID = `evt_${'0'.repeat(31)}1`;
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SIGNATURE = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
const customer = { id: 'fian_cus_sample', wallet: WALLET, email: 'payer@example.com', reference: 'user_42' };
const payment = { id: 'fian_pay_sample', status: 'SUCCEEDED' as const, signature: SIGNATURE };

type SessionStatus = WebhookEventMap['checkout.session.completed']['status'];
function session(status: SessionStatus): WebhookEventMap['checkout.session.completed'] {
  return {
    id: 'fian_cs_sample', object: 'checkout_session', mode: 'payment', status, order_id: 'order_1001',
    amount: '10000000', fee_amount: '100000', total_amount: '10100000', currency: 'USDC',
    interval: null, subscription: null, customer,
    payment: status === 'COMPLETED' ? payment : { id: null, status: null, signature: null },
    metadata: { cart: 'c_1' }, expires_at: LATER, created_at: AT,
    completed_at: status === 'COMPLETED' ? AT : null,
    expired_at: status === 'EXPIRED' ? LATER : null,
    canceled_at: status === 'CANCELED' ? AT : null,
  };
}

type OrderStatus = WebhookEventMap['order.paid']['status'];
function order(status: OrderStatus): WebhookEventMap['order.paid'] {
  return {
    id: 'fian_ord_sample', object: 'order', order_id: 'order_1001', checkout_session_id: 'fian_cs_sample', status,
    amount: '10000000', fee_amount: '100000', total_amount: '10100000', currency: 'USDC', customer,
    payment: status === 'PAID' ? { id: payment.id, signature: SIGNATURE } : { id: null, signature: null },
    metadata: { cart: 'c_1' }, created_at: AT,
    paid_at: status === 'PAID' ? AT : null,
    expired_at: status === 'EXPIRED' ? LATER : null,
  };
}

type Sub = WebhookEventMap['subscription.created'];
function subscription(patch: Partial<Sub>): Sub {
  return {
    id: 'fian_sub_sample', object: 'subscription', status: 'ACTIVE', order_id: 'sub_user_42_pro',
    price_id: 'fian_price_sample', plan_id: 'fian_plan_sample', product_name: 'Pro plan',
    amount: '10000000', fee_amount: '100000', total_amount: '10100000', currency: 'USDC',
    interval: 'MONTH', period_hours: 720, customer: { ...customer, wallet: WALLET },
    current_period_index: 0, current_period_start: AT, current_period_end: NEXT,
    cancel_at_period_end: false, cancel_at: null, cancel_reason: null, merchant_cancel_requested: false,
    end_reason: null, started_at: AT, ended_at: null, created_at: AT,
    payment, metadata: {},
    ...patch,
  };
}

const failure = { reason: 'INSUFFICIENT_FUNDS' as const, attempt_no: 1, next_attempt_at: LATER };
const unpaid = { id: null, status: null, signature: null };

const DATA: { [K in WebhookEventType]: () => WebhookEventMap[K] } = {
  'checkout.session.completed': () => session('COMPLETED'),
  'checkout.session.expired': () => session('EXPIRED'),
  'checkout.session.canceled': () => session('CANCELED'),
  'order.paid': () => order('PAID'),
  'order.expired': () => order('EXPIRED'),
  'order.duplicate_payment': () => ({ ...order('PAID'), duplicate: { signature: SIGNATURE.replace('5', '4'), amount: '10100000' } }),
  'subscription.created': () => subscription({}),
  'subscription.renewed': () => subscription({ current_period_index: 1, current_period_start: NEXT }),
  'subscription.past_due': () => subscription({ status: 'PAST_DUE', payment: unpaid, failure }),
  'subscription.payment_failed': () => subscription({ payment: unpaid, failure }),
  'subscription.ended': () => subscription({ status: 'ENDED', end_reason: 'PAYER_CANCELED', ended_at: LATER, payment: unpaid }),
  'subscription.cancel_scheduled': () => subscription({ cancel_at_period_end: true, cancel_at: NEXT, cancel_reason: 'PAYER_CANCELED', payment: unpaid }),
  'subscription.cancel_withdrawn': () => subscription({ payment: unpaid }),
  'test.event': () => ({ message: 'This is a test event from fianto.' }),
};

/** A realistic, schema-valid event for tests. Deterministic: no random ids, no clock. */
export function sampleEvent<T extends WebhookEventType>(
  type: T,
  overrides: { id?: string; timestamp?: string; data?: Partial<WebhookEventMap[T]> } = {},
): WebhookEventOf<T> {
  return {
    id: overrides.id ?? EVENT_ID,
    type,
    timestamp: overrides.timestamp ?? AT,
    data: { ...DATA[type](), ...overrides.data } as WebhookEventMap[T],
  };
}

export function sampleVerificationEvent(challenge = 'sample-challenge'): EndpointVerificationEvent {
  return { type: 'endpoint.verification', timestamp: AT, data: { challenge } };
}
