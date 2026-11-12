import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { FiantoError } from '../core/errors.js';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from './events.js';
import { sampleEvent, sampleVerificationEvent } from './samples.js';

const spec = JSON.parse(readFileSync(new URL('../../../../spec/openapi.json', import.meta.url), 'utf8'));

// Strict like the backend's contract test: no field the schema does not declare.
function strict(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strict);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = strict(v);
  if ('properties' in out && !('additionalProperties' in out)) out.additionalProperties = false;
  return out;
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('date-time', true);
ajv.addFormat('date', true);
ajv.addSchema({ $id: 'doc', components: strict(spec.components) });

it.each(WEBHOOK_EVENT_TYPES)('%s validates against the documented envelope', (type) => {
  const envelope = JSON.parse(
    JSON.stringify(spec.webhooks[type].post.requestBody.content['application/json'].schema).replaceAll('"#/components', '"doc#/components'),
  );
  const validate = ajv.compile(strict(envelope) as object);
  const event = sampleEvent(type);
  expect(validate(event), JSON.stringify(validate.errors)).toBe(true);
  expect(event.type).toBe(type);
});

// A key the spec marks "Absent on events created before …" is one today's backend always sends,
// so a sample (which stands for today's event) must carry it too (I2). Keys that are optional for
// another reason (`failure`, `period`, `duplicate.gateway`) depend on the event and stay optional.
const PRE_DEPLOY = /^Absent on events created before /;
function today(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(today);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = today(v);
  const properties = out.properties as Record<string, { description?: string }> | undefined;
  if (properties) {
    const required = new Set((out.required as string[] | undefined) ?? []);
    for (const [k, v] of Object.entries(properties)) if (PRE_DEPLOY.test(v.description ?? '')) required.add(k);
    out.required = [...required];
  }
  return out;
}

const todayAjv = new Ajv2020({ strict: false, allErrors: true });
todayAjv.addFormat('date-time', true);
todayAjv.addFormat('date', true);
todayAjv.addSchema({ $id: 'doc', components: today(strict(spec.components)) });

function validateToday(type: string, event: unknown): void {
  const envelope = JSON.parse(
    JSON.stringify(spec.webhooks[type].post.requestBody.content['application/json'].schema).replaceAll('"#/components', '"doc#/components'),
  );
  const validate = todayAjv.compile(today(strict(envelope)) as object);
  expect(validate(event), `${type}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

const CARD_TYPES = [
  'checkout.session.completed', 'checkout.session.expired', 'checkout.session.canceled',
  'order.paid', 'order.duplicate_payment', 'payment.refunded', 'payment.disputed',
  'subscription.created', 'subscription.renewed', 'subscription.past_due', 'subscription.payment_failed',
  'subscription.ended', 'subscription.cancel_scheduled', 'subscription.cancel_withdrawn',
] as const satisfies readonly WebhookEventType[];

it('validates every sample against the spec with every optional key present', () => {
  for (const type of WEBHOOK_EVENT_TYPES) validateToday(type, sampleEvent(type));
  for (const type of CARD_TYPES) validateToday(type, sampleEvent(type, { method: 'card' }));
  for (const type of WEBHOOK_EVENT_TYPES) validateToday(type, sampleEvent(type, { network: 'devnet' }));
});

it('makes crypto samples say crypto, with today\'s fields', () => {
  const paid = sampleEvent('order.paid').data;
  expect(paid.payment).toMatchObject({ gateway: 'solana', method: 'crypto' });
  expect(paid).toMatchObject({ refund_status: 'none', refunded_amount: '0', discount: null, discount_amount: '0', list_amount: paid.amount });
  expect(sampleEvent('checkout.session.completed').data.payment).toMatchObject({ gateway: 'solana', method: 'crypto', status: 'SUCCEEDED' });
  expect(sampleEvent('order.expired').data.payment).toEqual({ id: null, signature: null, gateway: null, method: null });
  expect(sampleEvent('checkout.session.expired').data.payment).toEqual({ id: null, status: null, signature: null, gateway: null, method: null });
  expect(sampleEvent('subscription.created').data).toMatchObject({ gateway: 'solana', method: 'crypto', card: null, currency: 'USDC' });
  expect(sampleEvent('payment.refunded').data.payment).toMatchObject({ gateway: 'solana', method: 'crypto', currency: 'USDC', card: null });
});

it('builds card samples', () => {
  const card = { brand: 'visa', last4: '4242' };
  const usd = (data: { currency: string; amount: string; fee_amount: string; network_fee_amount?: string; total_amount: string }, type: string) => {
    expect(data.currency, type).toBe('USD');
    expect(data.fee_amount, type).toBe('0');
    expect(data.network_fee_amount, type).toBe('0');
    expect(data.total_amount, type).toBe(data.amount);
  };

  const session = sampleEvent('checkout.session.completed', { method: 'card' }).data;
  usd(session, 'session');
  expect(session.amount).toBe('25000000');
  expect(session.customer.wallet).toBeNull();
  expect(session.payment).toEqual({ id: 'fian_pay_sample', status: 'SUCCEEDED', signature: null, gateway: 'stripe', method: 'card' });

  for (const type of ['order.paid', 'order.duplicate_payment'] as const) {
    const order = sampleEvent(type, { method: 'card' }).data;
    usd(order, type);
    expect(order.customer.wallet, type).toBeNull();
    expect(order.payment, type).toEqual({ id: 'fian_pay_sample', signature: null, gateway: 'stripe', method: 'card' });
  }
  expect(sampleEvent('order.duplicate_payment', { method: 'card' }).data.duplicate).toEqual({ signature: null, amount: '25000000', gateway: 'stripe' });

  for (const type of ['payment.refunded', 'payment.disputed'] as const) {
    const payment = sampleEvent(type, { method: 'card' }).data.payment;
    usd(payment, type);
    expect(payment, type).toMatchObject({ gateway: 'stripe', method: 'card', signature: null, slot: null, block_time: null, card });
    expect(payment.customer.wallet, type).toBeNull();
  }
  expect(sampleEvent('payment.refunded', { method: 'card' }).data.refund).toMatchObject({ gateway: 'stripe', status: 'succeeded' });

  for (const type of ['subscription.created', 'subscription.renewed', 'subscription.payment_failed'] as const) {
    const sub = sampleEvent(type, { method: 'card' }).data;
    usd(sub, type);
    expect(sub, type).toMatchObject({ gateway: 'stripe', method: 'card', card, plan_id: null });
    expect(sub.customer.wallet, type).toBeNull();
    expect(sub.payment.signature, type).toBeNull();
  }
  const renewed = sampleEvent('subscription.renewed', { method: 'card' }).data.period!;
  expect(renewed).toMatchObject({ amount_due: '25000000', fee_due: '0', network_fee_due: '0' });
  expect(sampleEvent('subscription.payment_failed', { method: 'card' }).data.failure?.reason).toBe('CARD_DECLINED');
});

it('builds a payment.disputed sample by card, since only a card payment is disputed', () => {
  expect(sampleEvent('payment.disputed').data.payment.method).toBe('card');
  expect(sampleEvent('payment.disputed').data.dispute).toMatchObject({ id: 'fian_dsp_sample', status: 'needs_response' });
});

it('refuses a method the event type has no sample for', () => {
  // @ts-expect-error a dispute is card only.
  expect(() => sampleEvent('payment.disputed', { method: 'crypto' })).toThrow(/payment\.disputed/);
  // @ts-expect-error an expired order was never paid, so it has no card form.
  expect(() => sampleEvent('order.expired', { method: 'card' })).toThrow(/order\.expired/);
  for (const type of ['test.event', 'invoice.issued', 'invoice.paid', 'invoice.voided', 'invoice.payment_recorded', 'credit_note.issued'] as const) {
    // @ts-expect-error no payment method on these events.
    expect(() => sampleEvent(type, { method: 'card' }), type).toThrow(FiantoError);
  }
  // `method: 'crypto'` is the default, so it is accepted wherever a sample exists without one.
  expect(sampleEvent('order.expired', { method: 'crypto' })).toEqual(sampleEvent('order.expired'));
});

it('stamps the sample network inside invoice payloads too', () => {
  expect(sampleEvent('invoice.paid', { network: 'devnet' }).data.network).toBe('devnet');
  expect(sampleEvent('invoice.payment_recorded', { network: 'devnet' }).data.network).toBe('devnet');
  expect(sampleEvent('credit_note.issued').data).toMatchObject({ object: 'credit_note', kind: 'credit_note', status: 'issued', credits: 'fian_inv_sample' });
});

it('is deterministic and applies overrides', () => {
  expect(sampleEvent('order.paid')).toEqual(sampleEvent('order.paid'));
  const event = sampleEvent('order.paid', { id: `evt_${'f'.repeat(32)}`, data: { order_id: 'shop-42' } });
  expect(event.id).toBe(`evt_${'f'.repeat(32)}`);
  expect(event.data.order_id).toBe('shop-42');
  expect(event.data.status).toBe('PAID');
});

it('gives each event a status that fits its type', () => {
  expect(sampleEvent('checkout.session.expired').data.status).toBe('EXPIRED');
  expect(sampleEvent('checkout.session.canceled').data.status).toBe('CANCELED');
  expect(sampleEvent('subscription.ended').data.status).toBe('ENDED');
  expect(sampleEvent('subscription.past_due').data.status).toBe('PAST_DUE');
  expect(sampleEvent('order.duplicate_payment').data.duplicate).toBeDefined();
});

it('builds the verification probe without an id', () => {
  expect(sampleVerificationEvent('abc')).toEqual({ type: 'endpoint.verification', timestamp: expect.any(String), network: 'mainnet', data: { challenge: 'abc' } });
});

// The network fee (October 2026): every subscription charge, the first included, and (since
// 29 October 2026) every one-time payment is price + Fianto fee + network fee, and `total_amount`
// includes it.
it('puts the network fee inside every subscription, session and order total', () => {
  const total = (d: { amount: string; fee_amount: string; network_fee_amount?: string }) =>
    BigInt(d.amount) + BigInt(d.fee_amount) + BigInt(d.network_fee_amount ?? '0');
  for (const type of WEBHOOK_EVENT_TYPES.filter((t) => t.startsWith('subscription.'))) {
    const data = sampleEvent(type as 'subscription.created').data;
    expect(data.network_fee_amount).toBe('10000');
    expect(BigInt(data.total_amount)).toBe(total(data));
  }
  const renewed = sampleEvent('subscription.renewed').data;
  expect(renewed.period?.network_fee_due).toBe('10000');
  expect(BigInt(renewed.period!.amount_due) + BigInt(renewed.period!.fee_due) + BigInt(renewed.period!.network_fee_due!)).toBe(
    BigInt(renewed.total_amount),
  );
  for (const type of ['checkout.session.completed', 'order.paid', 'order.expired', 'order.duplicate_payment'] as const) {
    const data = sampleEvent(type).data;
    expect(data.network_fee_amount, type).toBe('10000');
    expect(BigInt(data.total_amount), type).toBe(total(data));
  }
});

it('still validates an event stored before the network fee (no network_fee_amount)', () => {
  const envelope = JSON.parse(
    JSON.stringify(spec.webhooks['subscription.renewed'].post.requestBody.content['application/json'].schema).replaceAll('"#/components', '"doc#/components'),
  );
  const validate = ajv.compile(strict(envelope) as object);
  const event = sampleEvent('subscription.renewed');
  const { network_fee_amount: _fee, ...data } = event.data;
  const { network_fee_due: _due, ...period } = data.period!;
  expect(validate({ ...event, data: { ...data, total_amount: '10100000', period } }), JSON.stringify(validate.errors)).toBe(true);
});

it('still validates an order event stored before one-time payments carried the network fee', () => {
  for (const type of ['order.paid', 'order.duplicate_payment'] as const) {
    const envelope = JSON.parse(
      JSON.stringify(spec.webhooks[type].post.requestBody.content['application/json'].schema).replaceAll('"#/components', '"doc#/components'),
    );
    const validate = ajv.compile(strict(envelope) as object);
    const event = sampleEvent(type);
    const { network_fee_amount: _fee, ...data } = event.data;
    expect(validate({ ...event, data: { ...data, total_amount: '10100000' } }), JSON.stringify(validate.errors)).toBe(true);
  }
});
