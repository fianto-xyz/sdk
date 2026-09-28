import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { sampleEvent, signWebhook } from '@fianto/sdk/webhooks';
import { checkout, webhooks } from './index.js';

const secret = `whsec_${randomBytes(32).toString('base64')}`;

async function serve(app: express.Express) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

// Review Focus 2: the handler reads the raw stream itself.
it('verifies a webhook from the raw request stream', async () => {
  const onOrderPaid = vi.fn();
  const app = express();
  app.post('/webhooks', webhooks({ secret, onOrderPaid }));
  const { base, close } = await serve(app);
  const { body, headers } = await signWebhook({ event: sampleEvent('order.paid'), secret });
  const response = await fetch(`${base}/webhooks`, { method: 'POST', headers, body });
  await close();
  expect(response.status).toBe(200);
  expect(onOrderPaid).toHaveBeenCalledOnce();
});

it('accepts a Buffer body from express.raw()', async () => {
  const app = express();
  app.post('/webhooks', express.raw({ type: '*/*' }), webhooks({ secret }));
  const { base, close } = await serve(app);
  const { body, headers } = await signWebhook({ event: sampleEvent('test.event'), secret });
  const response = await fetch(`${base}/webhooks`, { method: 'POST', headers, body });
  await close();
  expect(response.status).toBe(200);
});

it('fails loudly when express.json() already parsed the body', async () => {
  const errors: string[] = [];
  const app = express();
  app.use(express.json());
  app.post('/webhooks', webhooks({ secret }));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    errors.push(error.message);
    res.status(500).end();
  });
  const { base, close } = await serve(app);
  const { body, headers } = await signWebhook({ event: sampleEvent('test.event'), secret });
  const response = await fetch(`${base}/webhooks`, { method: 'POST', headers, body });
  await close();
  expect(response.status).toBe(500);
  expect(errors[0]).toMatch(/before express\.json\(\)/);
});

it('rejects a body over 1 MiB with 413', async () => {
  const app = express();
  app.post('/webhooks', webhooks({ secret }));
  const { base, close } = await serve(app);
  const response = await fetch(`${base}/webhooks`, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) });
  await close();
  expect(response.status).toBe(413);
});

it('preserves multiple Set-Cookie headers from the merchant response', async () => {
  const app = express();
  app.post('/checkout', checkout({
    createSession: async () => {
      const headers = new Headers();
      headers.append('set-cookie', 'a=1');
      headers.append('set-cookie', 'b=2');
      return new Response(null, { status: 204, headers });
    },
  }));
  const { base, close } = await serve(app);
  const response = await fetch(`${base}/checkout`, { method: 'POST', headers: { origin: base } });
  await close();
  expect(response.headers.getSetCookie()).toHaveLength(2);
});

it('runs the checkout handler with the request origin', async () => {
  const app = express();
  app.post('/checkout', checkout({ createSession: async () => new Response('created by test', { status: 201 }) }));
  const { base, close } = await serve(app);
  const ok = await fetch(`${base}/checkout`, { method: 'POST', headers: { origin: base } });
  const bad = await fetch(`${base}/checkout`, { method: 'POST', headers: { origin: 'https://evil.test' } });
  await close();
  expect(ok.status).toBe(201);
  expect(await ok.text()).toBe('created by test');
  expect(bad.status).toBe(403);
});
