import { randomBytes } from 'node:crypto';
import { sampleEvent, signWebhook } from '@fianto/sdk/webhooks';
import { Checkout, Webhooks } from './index.js';

const secret = `whsec_${randomBytes(32).toString('base64')}`;

it('Webhooks() is a working App Router POST handler', async () => {
  const onOrderPaid = vi.fn();
  const POST = Webhooks({ secret, onOrderPaid });
  const { body, headers } = await signWebhook({ event: sampleEvent('order.paid'), secret });
  const response = await POST(new Request('https://shop.test/api/webhooks', { method: 'POST', headers, body }));
  expect(response.status).toBe(200);
  expect(onOrderPaid).toHaveBeenCalledOnce();
});

it('Checkout() refuses a cross-site request', async () => {
  const POST = Checkout({ createSession: async () => new Response('unused') });
  const response = await POST(new Request('https://shop.test/api/checkout', { method: 'POST', headers: { origin: 'https://evil.test' } }));
  expect(response.status).toBe(403);
});

// F11: the App Router's route context reaches createSession.
it('Checkout() passes the route context to createSession', async () => {
  const POST = Checkout({ createSession: async (_request, context) => new Response(JSON.stringify(await context.params)) });
  const request = () => new Request('https://shop.test/api/checkout', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
  const withContext = await POST(request(), { params: Promise.resolve({ plan: 'pro' }) });
  expect(await withContext.json()).toEqual({ plan: 'pro' });
  const without = await POST(request());
  expect(await without.json()).toEqual({});
});
