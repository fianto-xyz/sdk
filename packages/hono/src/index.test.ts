import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { sampleEvent, signWebhook } from '@fianto/sdk/webhooks';
import { checkout, webhooks } from './index.js';

const secret = `whsec_${randomBytes(32).toString('base64')}`;

it('mounts the webhook handler on a Hono app', async () => {
  const onOrderPaid = vi.fn();
  const app = new Hono().post('/webhooks/fianto', webhooks({ secret, onOrderPaid }));
  const { body, headers } = await signWebhook({ event: sampleEvent('order.paid'), secret });
  const response = await app.request('/webhooks/fianto', { method: 'POST', headers, body });
  expect(response.status).toBe(200);
  expect(onOrderPaid).toHaveBeenCalledOnce();
});

it('answers the verification probe through Hono', async () => {
  const app = new Hono().post('/webhooks/fianto', webhooks({ secret }));
  const { body, headers } = await signWebhook({ event: { type: 'endpoint.verification', timestamp: 't', data: { challenge: 'x' } }, secret });
  const response = await app.request('/webhooks/fianto', { method: 'POST', headers, body });
  expect(await response.json()).toEqual({ challenge: 'x' });
});

it('mounts the checkout handler', async () => {
  const app = new Hono().post('/checkout', checkout({ createSession: async () => new Response(null, { status: 204 }) }));
  const response = await app.request('/checkout', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
  expect(response.status).toBe(204);
});
