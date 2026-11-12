import type { Network } from '../core/config.js';
import { FiantoError } from '../core/errors.js';
import type { PaymentMethod } from '../types.js';
import type { EndpointVerificationEvent, WebhookEventMap, WebhookEventOf, WebhookEventType } from './events.js';

const AT = '2026-09-28T10:00:00.000Z';
const LATER = '2026-09-28T10:05:00.000Z';
const NEXT = '2026-10-28T10:00:00.000Z';
const LAST = '2026-11-27T10:00:00.000Z';
// `evt_` ids must stay 32 hex chars (the wire format the backend and this SDK validate), so a
// literal "sample" can't appear in one (C5) — this all-but-one-digit pattern is unmistakably a
// placeholder instead. The order/subscription ids below carry the "sample_" prefix that hex
// can't: a fake `order.paid` forwarded to a real merchant backend should never match a real order.
const EVENT_ID = `evt_${'0'.repeat(31)}1`;
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SIGNATURE = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
const PAYMENT_ID = 'fian_pay_sample';
const CARD = { brand: 'visa', last4: '4242' };
const customer = { id: 'fian_cus_sample', wallet: WALLET, email: 'payer@example.com', reference: 'user_42' };
const cardCustomer = { ...customer, wallet: null };
// No discount code: the list price is the price, and nothing is taken off.
const NO_DISCOUNT = { discount: null, discount_amount: '0' } as const;

/**
 * The figures of each rail. Crypto: price + Fianto fee + network fee = what the payer pays.
 * Card: fianto takes no fee, so the fees read "0" and the total is the price (US dollars, in the
 * same 6-decimal base units).
 */
const FIGURES = {
  crypto: { amount: '10000000', fee_amount: '100000', network_fee_amount: '10000', total_amount: '10110000', currency: 'USDC' },
  card: { amount: '25000000', fee_amount: '0', network_fee_amount: '0', total_amount: '25000000', currency: 'USD' },
} as const;

/** What every builder gets: the rail to sample and the network the envelope names. */
interface Context {
  method: PaymentMethod;
  network: Network;
}

type Session = WebhookEventMap['checkout.session.completed'];
function session(status: Session['status'], { method }: Context): Session {
  const paid = status === 'COMPLETED';
  const figures = FIGURES[method];
  return {
    id: 'fian_cs_sample', object: 'checkout_session', mode: 'payment', status, order_id: 'sample_order_1001',
    ...figures, list_amount: figures.amount, ...NO_DISCOUNT,
    interval: null, subscription: null, customer: method === 'card' ? cardCustomer : customer,
    payment: !paid
      ? { id: null, status: null, signature: null, gateway: null, method: null }
      : method === 'card'
        ? { id: PAYMENT_ID, status: 'SUCCEEDED', signature: null, gateway: 'stripe', method: 'card' }
        : { id: PAYMENT_ID, status: 'SUCCEEDED', signature: SIGNATURE, gateway: 'solana', method: 'crypto' },
    metadata: { cart: 'c_1' }, expires_at: LATER, created_at: AT,
    completed_at: paid ? AT : null,
    expired_at: status === 'EXPIRED' ? LATER : null,
    canceled_at: status === 'CANCELED' ? AT : null,
  };
}

type Order = WebhookEventMap['order.paid'];
function order(status: Order['status'], { method }: Context): Order {
  const paid = status === 'PAID';
  const figures = FIGURES[method];
  return {
    id: 'fian_ord_sample', object: 'order', order_id: 'sample_order_1001', checkout_session_id: 'fian_cs_sample', status,
    ...figures, list_amount: figures.amount, ...NO_DISCOUNT, refund_status: 'none', refunded_amount: '0',
    customer: method === 'card' ? cardCustomer : customer,
    payment: !paid
      ? { id: null, signature: null, gateway: null, method: null }
      : method === 'card'
        ? { id: PAYMENT_ID, signature: null, gateway: 'stripe', method: 'card' }
        : { id: PAYMENT_ID, signature: SIGNATURE, gateway: 'solana', method: 'crypto' },
    metadata: { cart: 'c_1' }, created_at: AT,
    paid_at: paid ? AT : null,
    expired_at: status === 'EXPIRED' ? LATER : null,
  };
}

function duplicate(context: Context): WebhookEventMap['order.duplicate_payment'] {
  return {
    ...order('PAID', context),
    duplicate: context.method === 'card'
      ? { signature: null, amount: FIGURES.card.amount, gateway: 'stripe' }
      : { signature: SIGNATURE.replace('5', '4'), amount: '10100000' },
  };
}

type Sub = WebhookEventMap['subscription.created'];
type SubPatch = Partial<Pick<Sub, 'status' | 'current_period_index' | 'current_period_start' | 'current_period_end' | 'cancel_at_period_end' | 'cancel_at' | 'cancel_reason' | 'end_reason' | 'ended_at' | 'period' | 'failure'>> & {
  /** False: the event names no payment (`{ id: null, status: null, signature: null }`). */
  paid?: boolean;
};
function subscription({ paid = true, ...patch }: SubPatch, { method }: Context): Sub {
  const common = {
    id: 'fian_sub_sample', object: 'subscription', status: 'ACTIVE', order_id: 'sample_sub_user_42_pro',
    price_id: 'fian_price_sample', product_name: 'Pro plan',
    interval: 'MONTH', period_hours: 720,
    current_period_index: 0, current_period_start: AT, current_period_end: NEXT,
    cancel_at_period_end: false, cancel_at: null, cancel_reason: null, merchant_cancel_requested: false,
    end_reason: null, started_at: AT, ended_at: null, created_at: AT, metadata: {},
  } as const;
  const unpaid = { id: null, status: null, signature: null };
  if (method === 'card') {
    const figures = FIGURES.card;
    return {
      ...common, ...figures, list_amount: figures.amount, ...NO_DISCOUNT,
      gateway: 'stripe', method: 'card', card: CARD, plan_id: null, customer: cardCustomer,
      payment: paid ? { id: PAYMENT_ID, status: 'SUCCEEDED', signature: null } : unpaid,
      ...patch,
    };
  }
  const figures = FIGURES.crypto;
  return {
    ...common, ...figures, list_amount: figures.amount, ...NO_DISCOUNT,
    gateway: 'solana', method: 'crypto', card: null, plan_id: 'fian_plan_sample', customer,
    payment: paid ? { id: PAYMENT_ID, status: 'SUCCEEDED', signature: SIGNATURE } : unpaid,
    ...patch,
  };
}

// The billing period a created/renewed event settled: the same price, fee and network fee.
function paid(index: number, start: string, end: string, { method }: Context): NonNullable<Sub['period']> {
  const figures = FIGURES[method];
  return {
    index, start, end, amount_due: figures.amount, fee_due: figures.fee_amount, network_fee_due: figures.network_fee_amount,
    status: 'PAID',
  };
}

function failure({ method }: Context): NonNullable<Sub['failure']> {
  return { reason: method === 'card' ? 'CARD_DECLINED' : 'INSUFFICIENT_FUNDS', attempt_no: 1, next_attempt_at: LATER };
}

type Payment = WebhookEventMap['payment.refunded']['payment'];
/** The v1 payment of the sample order (without `network`: the envelope carries it), `refunded` of it refunded. */
function payment({ method }: Context, refunded: string): Payment {
  const figures = FIGURES[method];
  const common = {
    id: PAYMENT_ID, object: 'payment', status: 'SUCCEEDED', order_id: 'sample_order_1001', checkout_session_id: 'fian_cs_sample',
    amount: figures.amount, fee_amount: figures.fee_amount, network_fee_amount: figures.network_fee_amount,
    total_amount: figures.total_amount,
    refund_status: refunded === '0' ? 'none' : BigInt(refunded) < BigInt(figures.amount) ? 'partial' : 'full',
    refunded_amount: refunded,
    created_at: AT, succeeded_at: AT, failed_at: null,
  } as const;
  const { reference: _reference, ...payer } = customer;
  if (method === 'card') {
    return {
      ...common, gateway: 'stripe', method: 'card', currency: 'USD', card: CARD, customer: { ...payer, wallet: null },
      signature: null, slot: null, block_time: null,
    };
  }
  return {
    ...common, gateway: 'solana', method: 'crypto', currency: 'USDC', card: null, customer: payer,
    signature: SIGNATURE, slot: '312000000', block_time: AT,
  };
}

function refunded(context: Context): WebhookEventMap['payment.refunded'] {
  // A partial refund: the payment's `refunded_amount` went up by `applied_amount`.
  if (context.method === 'card') {
    return {
      payment: payment(context, '10000000'),
      refund: { id: 'fian_ref_sample', amount: '10000000', applied_amount: '10000000', status: 'succeeded', gateway: 'stripe' },
    };
  }
  return {
    payment: payment(context, '4000000'),
    // A recorded crypto refund's id is the console's refund id (a UUID).
    refund: { id: '00000000-0000-4000-8000-000000000001', amount: '4000000', applied_amount: '4000000', status: 'succeeded', gateway: 'solana' },
  };
}

function disputed(context: Context): WebhookEventMap['payment.disputed'] {
  const card = payment(context, '0');
  if (card.method !== 'card') throw new FiantoError('A dispute sample is card only.');
  return { payment: card, dispute: { id: 'fian_dsp_sample', status: 'needs_response', amount: FIGURES.card.amount, due_by: NEXT } };
}

type Invoice = WebhookEventMap['invoice.issued'];
function invoice(status: 'open' | 'paid' | 'void', { network }: Context): Invoice {
  const isPaid = status === 'paid';
  return {
    id: 'fian_inv_sample', object: 'invoice', number: 'INV-0001', kind: 'invoice', document_type: 'invoice', status,
    source: 'manual', issue_date: '2026-09-28', due_date: '2026-10-28', currency: 'USD',
    subtotal: '10000000', tax_amount: '0', total: '10000000', credited_amount: '0',
    customer: { id: isPaid ? customer.id : null, wallet: isPaid ? WALLET : null, email: customer.email, reference: customer.reference },
    payment: isPaid ? { id: PAYMENT_ID, signature: SIGNATURE } : { id: null, signature: null },
    // A written invoice's Pay order is fianto's own, not the merchant's: no order_id.
    order_id: null, subscription_id: null, replaces: null, credits: null, created_at: AT, network,
  };
}

function creditNote(context: Context): Invoice {
  return {
    ...invoice('paid', context),
    id: 'fian_inv_sample_credit', object: 'credit_note', number: 'CN-0001', kind: 'credit_note', status: 'issued',
    due_date: null, subtotal: '4000000', total: '4000000', payment: { id: null, signature: null }, credits: 'fian_inv_sample',
  };
}

/** Which rails each type has a sample for; the first is the default. */
const METHODS = {
  'checkout.session.completed': ['crypto', 'card'],
  'checkout.session.expired': ['crypto', 'card'],
  'checkout.session.canceled': ['crypto', 'card'],
  'order.paid': ['crypto', 'card'],
  // An expired order was never paid, so it carries no card terms (its row keeps the crypto quote).
  'order.expired': ['crypto'],
  'order.duplicate_payment': ['crypto', 'card'],
  'payment.refunded': ['crypto', 'card'],
  'payment.disputed': ['card'],
  'subscription.created': ['crypto', 'card'],
  'subscription.renewed': ['crypto', 'card'],
  'subscription.past_due': ['crypto', 'card'],
  'subscription.payment_failed': ['crypto', 'card'],
  'subscription.ended': ['crypto', 'card'],
  'subscription.cancel_scheduled': ['crypto', 'card'],
  'subscription.cancel_withdrawn': ['crypto', 'card'],
  'invoice.issued': [],
  'invoice.paid': [],
  'invoice.voided': [],
  'invoice.payment_recorded': [],
  'credit_note.issued': [],
  'test.event': [],
} as const satisfies { [K in WebhookEventType]: readonly PaymentMethod[] };

/** The `method` values `sampleEvent(type, { method })` accepts for `T` (never for a type with no payment). */
export type SampleMethod<T extends WebhookEventType> = (typeof METHODS)[T][number];

const DATA: { [K in WebhookEventType]: (context: Context) => WebhookEventMap[K] } = {
  'checkout.session.completed': (c) => session('COMPLETED', c),
  'checkout.session.expired': (c) => session('EXPIRED', c),
  'checkout.session.canceled': (c) => session('CANCELED', c),
  'order.paid': (c) => order('PAID', c),
  'order.expired': (c) => order('EXPIRED', c),
  'order.duplicate_payment': duplicate,
  'payment.refunded': refunded,
  'payment.disputed': disputed,
  'subscription.created': (c) => subscription({ period: paid(0, AT, NEXT, c) }, c),
  'subscription.renewed': (c) =>
    subscription({ current_period_index: 1, current_period_start: NEXT, current_period_end: LAST, period: paid(1, NEXT, LAST, c) }, c),
  'subscription.past_due': (c) => subscription({ status: 'PAST_DUE', paid: false, failure: failure(c) }, c),
  'subscription.payment_failed': (c) => subscription({ paid: false, failure: failure(c) }, c),
  'subscription.ended': (c) => subscription({ status: 'ENDED', end_reason: 'PAYER_CANCELED', ended_at: LATER, paid: false }, c),
  'subscription.cancel_scheduled': (c) =>
    subscription({ cancel_at_period_end: true, cancel_at: NEXT, cancel_reason: 'PAYER_CANCELED', paid: false }, c),
  'subscription.cancel_withdrawn': (c) => subscription({ paid: false }, c),
  'invoice.issued': (c) => invoice('open', c),
  'invoice.paid': (c) => invoice('paid', c),
  'invoice.voided': (c) => invoice('void', c),
  // A recorded transfer applied to the sample invoice, leaving part of it due.
  'invoice.payment_recorded': ({ network }) => ({
    id: 'fian_inv_sample', number: 'INV-0001', external_payment_id: 'fian_xpay_sample',
    amount: '4000000', amount_paid: '4000000', amount_due: '6000000', signature: SIGNATURE, network,
  }),
  'credit_note.issued': creditNote,
  'test.event': () => ({ message: 'This is a test event from fianto.' }),
};

/**
 * A realistic, schema-valid event for tests: it carries every field today's backend sends.
 * Deterministic: no random ids, no clock.
 *
 * `method: 'card'` builds the card form of a payment, order, session or subscription event (US
 * dollars, no fee, no signature, no wallet, a Visa ending 4242); the default is crypto, except
 * for `payment.disputed`, which only a card payment can be. A type with no such form
 * (`order.expired` by card, `payment.disputed` by crypto, invoice events, `test.event`) refuses
 * it: a type error in TypeScript, and a `FiantoError` at runtime.
 */
export function sampleEvent<T extends WebhookEventType>(
  type: T,
  overrides: {
    id?: string;
    timestamp?: string;
    network?: Network;
    data?: Partial<WebhookEventMap[T]>;
    method?: SampleMethod<T>;
  } = {},
): WebhookEventOf<T> {
  const methods: readonly PaymentMethod[] = METHODS[type];
  const method = overrides.method ?? methods[0] ?? 'crypto';
  if (overrides.method !== undefined && !methods.includes(overrides.method)) {
    throw new FiantoError(
      methods.length === 0
        ? `${type} has no payment method, so it has no ${overrides.method} sample.`
        : `${type} has no ${overrides.method} sample; it has: ${methods.join(', ')}.`,
    );
  }
  const network = overrides.network ?? 'mainnet';
  const build = DATA[type] as (context: Context) => WebhookEventMap[T];
  return {
    id: overrides.id ?? EVENT_ID,
    type,
    timestamp: overrides.timestamp ?? AT,
    network,
    data: { ...build({ method, network }), ...overrides.data } as WebhookEventMap[T],
  };
}

export function sampleVerificationEvent(challenge = 'sample-challenge'): EndpointVerificationEvent {
  return { type: 'endpoint.verification', timestamp: AT, network: 'mainnet', data: { challenge } };
}
