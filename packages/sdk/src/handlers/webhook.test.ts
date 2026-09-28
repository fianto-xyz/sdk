import { randomBytes } from 'node:crypto';
import { sampleEvent, sampleVerificationEvent } from '../webhooks/samples.js';
import { signWebhook } from '../webhooks/sign.js';
import { createWebhookHandler } from './webhook.js';

const secret = `whsec_${randomBytes(32).toString('base64')}`;

async function post(event: object, init: { secret?: string; method?: string } = {}) {
  const { body, headers } = await signWebhook({ event, secret: init.secret ?? secret });
  return new Request('https://shop.test/api/webhooks/fianto', { method: init.method ?? 'POST', headers, body: init.method === 'GET' ? undefined : body });
}

it('routes a verified event to its callback, then onEvent', async () => {
  const order: string[] = [];
  const handler = createWebhookHandler({
    secret,
    onOrderPaid: async (event) => { order.push(`paid:${event.data.order_id}`); },
    onEvent: (event) => { order.push(`any:${event.type}`); },
  });
  const response = await handler(await post(sampleEvent('order.paid')));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true });
  expect(order).toEqual(['paid:order_1001', 'any:order.paid']);
});

it('answers the verification probe with its challenge and calls nothing else', async () => {
  const onEvent = vi.fn();
  const response = await createWebhookHandler({ secret, onEvent })(await post(sampleVerificationEvent('c-123')));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ challenge: 'c-123' });
  expect(onEvent).not.toHaveBeenCalled();
});

it('rejects a bad signature with a generic 400 and reports the reason privately', async () => {
  const onVerificationError = vi.fn();
  const onEvent = vi.fn();
  const other = `whsec_${randomBytes(32).toString('base64')}`;
  const response = await createWebhookHandler({ secret, onEvent, onVerificationError })(await post(sampleEvent('order.paid'), { secret: other }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'invalid_webhook' });
  expect(onVerificationError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no_matching_signature' }));
  expect(onEvent).not.toHaveBeenCalled();
});

it('answers 500 when a callback throws, so fianto retries', async () => {
  const handler = createWebhookHandler({ secret, onOrderPaid: () => { throw new Error('db down'); } });
  const response = await handler(await post(sampleEvent('order.paid')));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'handler_failed' });
});

it('passes unknown event types to onEvent only', async () => {
  const onEvent = vi.fn();
  const response = await createWebhookHandler({ secret, onEvent })(
    await post({ id: `evt_${'9'.repeat(32)}`, type: 'invoice.created', timestamp: 't', data: {} }),
  );
  expect(response.status).toBe(200);
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'invoice.created' }));
});

it('refuses other methods', async () => {
  const response = await createWebhookHandler({ secret })(new Request('https://shop.test/x', { method: 'GET' }));
  expect(response.status).toBe(405);
  expect(response.headers.get('allow')).toBe('POST');
});

it('maps every event type to exactly one callback', async () => {
  const seen: string[] = [];
  const callbacks = Object.fromEntries(
    [
      'onCheckoutSessionCompleted', 'onCheckoutSessionExpired', 'onCheckoutSessionCanceled', 'onOrderPaid',
      'onOrderExpired', 'onOrderDuplicatePayment', 'onSubscriptionCreated', 'onSubscriptionRenewed',
      'onSubscriptionPastDue', 'onSubscriptionPaymentFailed', 'onSubscriptionEnded',
      'onSubscriptionCancelScheduled', 'onSubscriptionCancelWithdrawn', 'onTestEvent',
    ].map((name) => [name, () => { seen.push(name); }]),
  );
  const handler = createWebhookHandler({ secret, ...callbacks });
  const { WEBHOOK_EVENT_TYPES } = await import('../webhooks/events.js');
  for (const type of WEBHOOK_EVENT_TYPES) await handler(await post(sampleEvent(type)));
  expect(new Set(seen).size).toBe(14);
});

it('reports a throwing callback or onEvent to onError with the event', async () => {
  const boom = new Error('db down');
  const onError = vi.fn();
  const response = await createWebhookHandler({ secret, onOrderPaid: () => { throw boom; }, onError })(await post(sampleEvent('order.paid')));
  expect(response.status).toBe(500);
  expect(onError).toHaveBeenCalledWith(boom, expect.objectContaining({ type: 'order.paid' }));

  const onError2 = vi.fn();
  const r2 = await createWebhookHandler({ secret, onEvent: () => { throw boom; }, onError: onError2 })(await post(sampleEvent('order.paid')));
  expect(r2.status).toBe(500);
  expect(onError2).toHaveBeenCalledTimes(1);
});

it('never lets a throwing onError or onVerificationError escape', async () => {
  const handler = createWebhookHandler({ secret, onOrderPaid: () => { throw new Error('x'); }, onError: () => { throw new Error('y'); } });
  expect((await handler(await post(sampleEvent('order.paid')))).status).toBe(500);
  const other = `whsec_${randomBytes(32).toString('base64')}`;
  const bad = createWebhookHandler({ secret, onVerificationError: () => { throw new Error('z'); } });
  expect((await bad(await post(sampleEvent('order.paid'), { secret: other }))).status).toBe(400);
});

it('does not treat inherited property names as event types', async () => {
  const onEvent = vi.fn();
  const response = await createWebhookHandler({ secret, onEvent })(
    await post({ id: `evt_${'8'.repeat(32)}`, type: 'toString', timestamp: 't', data: {} }),
  );
  expect(response.status).toBe(200);
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'toString' }));
});
