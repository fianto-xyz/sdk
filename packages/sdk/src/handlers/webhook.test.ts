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
  expect(order).toEqual(['paid:sample_order_1001', 'any:order.paid']);
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

/** A body stream that records whether anything pulled from it. */
function trackedBody(chunks: Uint8Array[]) {
  const state = { pulled: 0, canceled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[state.pulled++];
      if (next) controller.enqueue(next); else controller.close();
    },
    cancel() { state.canceled = true; },
  }, { highWaterMark: 0 }); // pull only when read, so `pulled` counts real reads
  return { stream, state };
}

function streamed(headers: Record<string, string>, stream: ReadableStream<Uint8Array>) {
  return new Request('https://shop.test/api/webhooks/fianto', { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit);
}

// C1: an unauthenticated request cannot make the handler read (and hold) a large body.
it.each([
  ['no signature headers', {}],
  ['a stale timestamp', { 'webhook-id': 'evt_x', 'webhook-timestamp': '1000', 'webhook-signature': 'v1,AAAA' }],
])('refuses %s with 400 before reading the body', async (_, headers) => {
  const { stream, state } = trackedBody([new Uint8Array(10)]);
  const onVerificationError = vi.fn();
  const response = await createWebhookHandler({ secret, onVerificationError })(streamed(headers, stream));
  expect(response.status).toBe(400);
  expect(state.pulled).toBe(0);
  expect(onVerificationError).toHaveBeenCalledOnce();
});

it('refuses a content-length over maxBodyBytes with 413 without reading', async () => {
  const { headers } = await signWebhook({ event: sampleEvent('order.paid'), secret });
  const { stream, state } = trackedBody([new Uint8Array(10)]);
  const onVerificationError = vi.fn();
  const handler = createWebhookHandler({ secret, maxBodyBytes: 100, onVerificationError });
  const response = await handler(streamed({ ...headers, 'content-length': '101' }, stream));
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: 'payload_too_large' });
  expect(state.pulled).toBe(0);
  expect(onVerificationError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'payload_too_large' }));
});

it('stops reading a chunked body as soon as it passes maxBodyBytes and answers 413', async () => {
  const { headers } = await signWebhook({ event: sampleEvent('order.paid'), secret });
  const chunks = Array.from({ length: 50 }, () => new Uint8Array(64));
  const { stream, state } = trackedBody(chunks);
  const response = await createWebhookHandler({ secret, maxBodyBytes: 100 })(streamed(headers, stream));
  expect(response.status).toBe(413);
  expect(state.pulled).toBeLessThanOrEqual(3);
  expect(state.canceled).toBe(true);
});

it('defaults maxBodyBytes to 1 MiB and accepts a body exactly at the limit', async () => {
  const pad = (size: number) => {
    const event = sampleEvent('test.event', { data: { message: '' } });
    return { ...event, data: { message: 'x'.repeat(size - JSON.stringify(event).length) } };
  };
  const handler = createWebhookHandler({ secret });
  const atLimit = await signWebhook({ event: pad(1_048_576), secret });
  expect(atLimit.body.length).toBe(1_048_576);
  const ok = await handler(new Request('https://shop.test/x', { method: 'POST', headers: atLimit.headers, body: atLimit.body }));
  expect(ok.status).toBe(200);
  const over = await signWebhook({ event: pad(1_048_577), secret });
  const refused = await handler(new Request('https://shop.test/x', { method: 'POST', headers: over.headers, body: over.body }));
  expect(refused.status).toBe(413);
});

it('refuses a bad maxBodyBytes, a short secret or an unbounded tolerance at creation', () => {
  for (const maxBodyBytes of [0, -1, 1.5, Number.NaN, Infinity]) {
    expect(() => createWebhookHandler({ secret, maxBodyBytes })).toThrow(/maxBodyBytes/);
  }
  expect(() => createWebhookHandler({ secret: `whsec_${randomBytes(8).toString('base64')}` })).toThrow(/at least 16 bytes/);
  expect(() => createWebhookHandler({ secret, toleranceSeconds: 7200 })).toThrow(/toleranceSeconds/);
});

it('reads FIANTO_WEBHOOK_SECRET per request when no secret is passed', async () => {
  const handler = createWebhookHandler();
  vi.stubEnv('FIANTO_WEBHOOK_SECRET', secret);
  expect((await handler(await post(sampleEvent('order.paid')))).status).toBe(200);
  vi.unstubAllEnvs();
});
