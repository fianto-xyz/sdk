import { Fianto } from '../client.js';
import { createCheckoutHandler } from './checkout.js';

function fakeFianto(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ path: string; body: unknown }> = [];
  const fianto = new Fianto({
    appId: 'fian_app_1', appSecret: 'fian_sk_live_2', baseUrl: 'https://api.test', maxRetries: 0,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ path: new URL(url).pathname, body: init.body ? JSON.parse(init.body as string) : undefined });
      const next = responses.shift()!;
      return new Response(JSON.stringify(next.body), { status: next.status, headers: next.headers });
    }) as unknown as typeof fetch,
  });
  return { fianto, calls };
}

const params = {
  mode: 'payment' as const, order_id: 'o-1', amount: '10', description: 'Coffee',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
const sameOrigin = () => new Request('https://shop.test/api/checkout', { method: 'POST', headers: { origin: 'https://shop.test' }, body: '{}' });

it('creates a popup session and answers { id, url }', async () => {
  const { fianto, calls } = fakeFianto([{ status: 201, body: { id: 'fian_cs_1', url: 'https://pay.test/c/t1' } }]);
  const handler = createCheckoutHandler({ fianto, createSession: async () => params });
  const response = await handler(sameOrigin());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'fian_cs_1', url: 'https://pay.test/c/t1' });
  expect(calls[0]).toEqual({ path: '/v1/checkout-sessions', body: { ...params, ui_mode: 'popup' } });
});

it('reissues the link when the order already has an open session', async () => {
  const { fianto, calls } = fakeFianto([
    { status: 201, body: { id: 'fian_cs_1', url: null } },
    { status: 200, body: { id: 'fian_cs_1', url: 'https://pay.test/c/t2' } },
  ]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(sameOrigin());
  expect(await response.json()).toEqual({ id: 'fian_cs_1', url: 'https://pay.test/c/t2' });
  expect(calls.map((c) => c.path)).toEqual(['/v1/checkout-sessions', '/v1/checkout-sessions/fian_cs_1/link']);
});

it('passes payment_in_progress through as 409', async () => {
  const { fianto } = fakeFianto([
    { status: 201, body: { id: 'fian_cs_1', url: null } },
    { status: 409, body: { statusCode: 409, error: 'Conflict', code: 'payment_in_progress', message: 'A payment is in progress.', request_id: 'req_12345678' } },
  ]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(sameOrigin());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: { code: 'payment_in_progress', message: 'A payment is in progress.' } });
});

it('hides credential errors behind a 500', async () => {
  const { fianto } = fakeFianto([{ status: 401, body: { code: 'invalid_api_credentials', message: 'bad creds' } }]);
  const onError = vi.fn();
  const response = await createCheckoutHandler({ fianto, createSession: async () => params, onError })(sameOrigin());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: 'internal_error', message: 'Checkout could not be started.' } });
  expect(onError).toHaveBeenCalled();
});

// Review Focus 4: cross-site requests never reach the API.
it.each([
  [{ origin: 'https://evil.test' }],
  [{}],
  [{ 'sec-fetch-site': 'cross-site', origin: 'https://evil.test' }],
])('refuses %j with 403 before any API call', async (headers) => {
  const { fianto, calls } = fakeFianto([]);
  const createSession = vi.fn(async () => params);
  const response = await createCheckoutHandler({ fianto, createSession })(
    new Request('https://shop.test/api/checkout', { method: 'POST', headers, body: '{}' }),
  );
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe('forbidden_origin');
  expect(createSession).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
});

it('trusts Sec-Fetch-Site: same-origin behind a proxy and an allow-listed origin', async () => {
  const first = fakeFianto([{ status: 201, body: { id: 'a', url: 'https://pay.test/c/a' } }]);
  const proxied = new Request('http://internal:3000/api/checkout', { method: 'POST', headers: { origin: 'https://shop.test', 'sec-fetch-site': 'same-origin' }, body: '{}' });
  expect((await createCheckoutHandler({ fianto: first.fianto, createSession: async () => params })(proxied)).status).toBe(200);

  const second = fakeFianto([{ status: 201, body: { id: 'b', url: 'https://pay.test/c/b' } }]);
  const listed = new Request('http://internal:3000/api/checkout', { method: 'POST', headers: { origin: 'https://shop.test' }, body: '{}' });
  const handler = createCheckoutHandler({ fianto: second.fianto, createSession: async () => params, allowedOrigins: ['https://shop.test'] });
  expect((await handler(listed)).status).toBe(200);
});

it('returns a Response from createSession unchanged', async () => {
  const { fianto, calls } = fakeFianto([]);
  const handler = createCheckoutHandler({ fianto, createSession: async () => new Response('bad plan', { status: 400 }) });
  const response = await handler(sameOrigin());
  expect(response.status).toBe(400);
  expect(calls).toHaveLength(0);
});

it('refuses other methods', async () => {
  const { fianto } = fakeFianto([]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(new Request('https://shop.test/x'));
  expect(response.status).toBe(405);
});
