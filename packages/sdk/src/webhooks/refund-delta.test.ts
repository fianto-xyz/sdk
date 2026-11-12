import { AmountError } from '../amounts.js';
import type { PaymentRefundedEvent, WebhookEventOf } from './events.js';
import { refundDelta } from './refund-delta.js';
import { sampleEvent } from './samples.js';

type RefundStatus = PaymentRefundedEvent['refund']['status'];

let next = 0;
/** One `payment.refunded` event: a fresh event id, and the given refund status, id and applied amount. */
function refunded(status: RefundStatus, applied: string, refundId = 'fian_ref_sample'): WebhookEventOf<'payment.refunded'> {
  next += 1;
  const event = sampleEvent('payment.refunded', { id: `evt_${next.toString(16).padStart(32, '0')}`, method: 'card' });
  return { ...event, data: { ...event.data, refund: { ...event.data.refund, id: refundId, status, applied_amount: applied } } };
}

/** What an integrator keeps: a seed, plus each event's delta counted once per event id. */
function total(seed: bigint, events: readonly WebhookEventOf<'payment.refunded'>[]): bigint {
  const counted = new Map<string, bigint>();
  for (const event of events) if (!counted.has(event.id)) counted.set(event.id, refundDelta(event.data));
  return [...counted.values()].reduce((sum, delta) => sum + delta, seed);
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

it('adds succeeded and dispute_lost', () => {
  expect(refundDelta(refunded('succeeded', '4000000').data)).toBe(4_000_000n);
  expect(refundDelta(refunded('dispute_lost', '25000000', 'fian_dsp_sample').data)).toBe(25_000_000n);
});

it('subtracts failed and reversed', () => {
  expect(refundDelta(refunded('failed', '4000000').data)).toBe(-4_000_000n);
  expect(refundDelta(refunded('reversed', '25000000', 'fian_dsp_sample').data)).toBe(-25_000_000n);
});

it('sums a lost dispute and its late win to zero', () => {
  const lost = refunded('dispute_lost', '25000000', 'fian_dsp_sample');
  const won = refunded('reversed', '25000000', 'fian_dsp_sample');
  expect(total(0n, [lost, won])).toBe(0n);
});

it('counts two succeeded events with one refund id', () => {
  // One card refund can move the figure twice (two `succeeded` events, the same `refund.id`).
  const first = refunded('succeeded', '6000000', 'fian_ref_one');
  const second = refunded('succeeded', '4000000', 'fian_ref_one');
  expect(first.data.refund.id).toBe(second.data.refund.id);
  expect(total(0n, [first, second])).toBe(10_000_000n);
});

it('dedupes by event id, not refund id', () => {
  const event = refunded('succeeded', '4000000');
  const redelivered = structuredClone(event);
  const other = refunded('succeeded', '1000000');
  expect(total(0n, [event, redelivered, other])).toBe(5_000_000n);
});

it('gives the same total in any order', () => {
  const events = [
    refunded('succeeded', '10000000', 'fian_ref_one'),
    refunded('dispute_lost', '15000000', 'fian_dsp_sample'),
    refunded('failed', '10000000', 'fian_ref_one'),
    refunded('reversed', '5000000', 'fian_dsp_sample'),
  ];
  const all = permutations(events);
  expect(all).toHaveLength(24);
  for (const order of all) expect(total(2_000_000n, order)).toBe(12_000_000n);
});

it('accepts the sample of either rail', () => {
  expect(refundDelta(sampleEvent('payment.refunded').data)).toBe(BigInt(sampleEvent('payment.refunded').data.refund.applied_amount));
  expect(refundDelta(sampleEvent('payment.refunded', { method: 'card' }).data)).toBeGreaterThan(0n);
});

it('refuses an applied amount that is not a positive base-unit integer', () => {
  for (const applied of ['0', '-5', '1.5', '', ' 7', '0x10']) {
    expect(() => refundDelta(refunded('succeeded', applied).data), applied).toThrow(AmountError);
  }
});

it('refuses a refund status this SDK version does not know, so the delivery is retried', () => {
  const event = refunded('succeeded', '4000000');
  const data = { ...event.data, refund: { ...event.data.refund, status: 'adjusted' as RefundStatus } };
  expect(() => refundDelta(data)).toThrow(/adjusted/);
  expect(() => refundDelta(data)).toThrow(AmountError);
});
