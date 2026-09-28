import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
// @ts-expect-error express4 is `npm:express@4` (a dev-only alias) and ships no types; cast below.
import express4 from 'express4';
import { sampleEvent, signWebhook } from '@fianto/sdk/webhooks';
import { toFetchRequest } from './bridge.js';
import { checkout, webhooks } from './index.js';

const secret = `whsec_${randomBytes(32).toString('base64')}`;

async function serve(app: express.Express) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Records the error an Express error handler receives, answering 500. */
function catchErrors(app: express.Express, errors: string[]) {
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    errors.push(error.message);
    res.status(500).end();
  });
}

// Every behaviour below holds on both majors the peer range (`express >=4`) allows.
describe.each([
  ['Express 5', express],
  ['Express 4', express4 as typeof express],
])('%s', (_, framework) => {
  // Review Focus 2: the handler reads the raw stream itself.
  it('verifies a webhook from the raw request stream', async () => {
    const onOrderPaid = vi.fn();
    const app = framework();
    app.post('/webhooks', webhooks({ secret, onOrderPaid }));
    const { base, close } = await serve(app);
    const { body, headers } = await signWebhook({ event: sampleEvent('order.paid'), secret });
    const response = await fetch(`${base}/webhooks`, { method: 'POST', headers, body });
    await close();
    expect(response.status).toBe(200);
    expect(onOrderPaid).toHaveBeenCalledOnce();
  });

  it('accepts a Buffer body from express.raw()', async () => {
    const app = framework();
    app.post('/webhooks', framework.raw({ type: '*/*' }), webhooks({ secret }));
    const { base, close } = await serve(app);
    const { body, headers } = await signWebhook({ event: sampleEvent('test.event'), secret });
    const response = await fetch(`${base}/webhooks`, { method: 'POST', headers, body });
    await close();
    expect(response.status).toBe(200);
  });

  // F24: a global parser for another content type leaves the JSON webhook's stream untouched
  // (Express 4's body-parser still sets req.body = {}), so the bridge reads it itself.
  it('verifies a JSON webhook behind global express.urlencoded() and express.text()', async () => {
    const onTestEvent = vi.fn();
    const app = framework();
    app.use(framework.urlencoded({ extended: false }));
    app.use(framework.text());
    app.post('/webhooks', webhooks({ secret, onTestEvent }));
    const { base, close } = await serve(app);
    const { body, headers } = await signWebhook({ event: sampleEvent('test.event'), secret });
    const response = await fetch(`${base}/webhooks`, { method: 'POST', headers, body });
    await close();
    expect(response.status).toBe(200);
    expect(onTestEvent).toHaveBeenCalledOnce();
  });

  it('fails loudly, naming the fix, when express.json() already read the body', async () => {
    const errors: string[] = [];
    const app = framework();
    app.use(framework.json());
    app.post('/webhooks', webhooks({ secret }));
    catchErrors(app, errors);
    const { base, close } = await serve(app);
    const { body, headers } = await signWebhook({ event: sampleEvent('test.event'), secret });
    const response = await fetch(`${base}/webhooks`, { method: 'POST', headers, body });
    await close();
    expect(response.status).toBe(500);
    expect(errors[0]).toMatch(/before express\.json\(\)/);
    expect(errors[0]).toMatch(/express\.raw\(\{ type: "\*\/\*" \}\)/);
  });

  it('rejects a body over 1 MiB with 413', async () => {
    const app = framework();
    app.post('/webhooks', webhooks({ secret }));
    const { base, close } = await serve(app);
    const response = await fetch(`${base}/webhooks`, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) });
    await close();
    expect(response.status).toBe(413);
  });

  it('honours the webhook handler\'s maxBodyBytes', async () => {
    const app = framework();
    app.post('/webhooks', webhooks({ secret, maxBodyBytes: 100 }));
    const { base, close } = await serve(app);
    const { body, headers } = await signWebhook({ event: sampleEvent('order.paid'), secret });
    const response = await fetch(`${base}/webhooks`, { method: 'POST', headers, body });
    await close();
    expect(body.length).toBeGreaterThan(100);
    expect(response.status).toBe(413);
  });

  it('runs the checkout handler with the request origin', async () => {
    const app = framework();
    app.post('/checkout', checkout({ createSession: async () => new Response('created by test', { status: 201 }) }));
    const { base, close } = await serve(app);
    const ok = await fetch(`${base}/checkout`, { method: 'POST', headers: { origin: base } });
    const bad = await fetch(`${base}/checkout`, { method: 'POST', headers: { origin: 'https://evil.test' } });
    await close();
    expect(ok.status).toBe(201);
    expect(await ok.text()).toBe('created by test');
    expect(bad.status).toBe(403);
  });

  // F11: Express's own req/res reach createSession (req.user and friends set by earlier middleware).
  it('passes { req, res } to createSession', async () => {
    const app = framework();
    app.use((req: express.Request & { user?: string }, _res: express.Response, next: express.NextFunction) => {
      req.user = 'u_1';
      next();
    });
    app.post('/checkout', checkout({
      createSession: async (_request, { req, res }) => new Response(`${(req as { user?: string }).user}:${typeof res.status}`),
    }));
    const { base, close } = await serve(app);
    const response = await fetch(`${base}/checkout`, { method: 'POST', headers: { origin: base } });
    await close();
    expect(await response.text()).toBe('u_1:function');
  });
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

it('refuses a declared content-length over the limit without reading the stream', async () => {
  const read = vi.fn();
  const req = {
    method: 'POST', body: undefined, headers: { 'content-length': '2048' }, readableEnded: false, readableDidRead: false,
    [Symbol.asyncIterator]: read,
  };
  await expect(toFetchRequest(req as never, 1024)).rejects.toMatchObject({ name: 'PayloadTooLargeError' });
  expect(read).not.toHaveBeenCalled();
});
