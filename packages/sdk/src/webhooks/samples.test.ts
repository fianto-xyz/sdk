import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { WEBHOOK_EVENT_TYPES } from './events.js';
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
  expect(sampleVerificationEvent('abc')).toEqual({ type: 'endpoint.verification', timestamp: expect.any(String), data: { challenge: 'abc' } });
});

// The renewal network fee (October 2026): every subscription charge, the first included, is
// price + Fianto fee + network fee, and `total_amount` includes it. A payment session has none.
it('puts the network fee inside every subscription total, and none on a payment session', () => {
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
  const session = sampleEvent('checkout.session.completed').data;
  expect(session.network_fee_amount).toBe('0');
  expect(BigInt(session.total_amount)).toBe(total(session));
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
