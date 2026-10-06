import { Fianto } from '../client.js';
import { createCheckoutHandler } from './checkout.js';
import { isAPIError, isFiantoError } from '../core/errors.js';
import { OpenSessionPriceEndedError } from './session-match.js';

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
/** What create answers for an order that already has an OPEN session: url null. */
const open = (patch: Record<string, unknown> = {}) => ({
  id: 'fian_cs_1', object: 'checkout_session', url: null, mode: 'payment', ui_mode: 'popup',
  status: 'OPEN', amount: '10000000', currency: 'USDC', interval: null, ...patch,
});
const sameOrigin = () => new Request('https://shop.test/api/checkout', { method: 'POST', headers: { origin: 'https://shop.test' }, body: '{}' });

it('creates a popup session and answers { id, url }', async () => {
  const { fianto, calls } = fakeFianto([{ status: 201, body: { id: 'fian_cs_1', url: 'https://pay.test/c/t1' } }]);
  const handler = createCheckoutHandler({ fianto, createSession: async () => params });
  const response = await handler(sameOrigin());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'fian_cs_1', url: 'https://pay.test/c/t1' });
  expect(calls[0]).toEqual({ path: '/v1/checkout-sessions', body: { ...params, ui_mode: 'popup' } });
});

it('reissues the link when the order already has an open session with the same terms', async () => {
  const { fianto, calls } = fakeFianto([
    { status: 201, body: open() },
    { status: 200, body: { id: 'fian_cs_1', url: 'https://pay.test/c/t2' } },
  ]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(sameOrigin());
  expect(await response.json()).toEqual({ id: 'fian_cs_1', url: 'https://pay.test/c/t2' });
  expect(calls.map((c) => c.path)).toEqual(['/v1/checkout-sessions', '/v1/checkout-sessions/fian_cs_1/link']);
});

it('passes payment_in_progress through as 409', async () => {
  const { fianto } = fakeFianto([
    { status: 201, body: open() },
    { status: 409, body: { statusCode: 409, error: 'Conflict', code: 'payment_in_progress', message: 'Upstream wording.', request_id: 'req_12345678' } },
  ]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(sameOrigin());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: 'payment_in_progress', message: 'A payment for this order may already be in progress. Wait a minute before trying again.' },
  });
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

it('reports passed-through API errors to onError too, response unchanged', async () => {
  const { fianto } = fakeFianto([
    { status: 409, body: { code: 'checkout_unavailable', message: 'Busy.' }, headers: { 'retry-after': '2' } },
  ]);
  const onError = vi.fn();
  const response = await createCheckoutHandler({ fianto, createSession: async () => params, onError })(sameOrigin());
  expect(response.status).toBe(409);
  expect(response.headers.get('retry-after')).toBe('2');
  expect(await response.json()).toEqual({ error: { code: 'checkout_unavailable', message: 'Checkout is unavailable right now. Try again in a moment.' } });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'checkout_unavailable' }));
});

it.each([
  [{ 'sec-fetch-site': 'same-site', origin: 'https://sub.shop.test' }],
  [{ 'sec-fetch-site': 'none' }],
  [{ 'sec-fetch-site': 'same-site' }],
])('refuses %j with 403 (only same-origin is trusted)', async (headers) => {
  const { fianto, calls } = fakeFianto([]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(
    new Request('https://shop.test/api/checkout', { method: 'POST', headers, body: '{}' }),
  );
  expect(response.status).toBe(403);
  expect(calls).toHaveLength(0);
});

it('forces ui_mode popup over a cast-injected redirect', async () => {
  const { fianto, calls } = fakeFianto([{ status: 201, body: { id: 'fian_cs_1', url: 'https://pay.test/c/t1' } }]);
  const injected = { ...params, ui_mode: 'redirect' } as unknown as typeof params;
  await createCheckoutHandler({ fianto, createSession: async () => injected })(sameOrigin());
  expect((calls[0]!.body as { ui_mode: string }).ui_mode).toBe('popup');
});

// A3: a reissued link must never carry terms other than the ones just asked for.
const MISMATCH = {
  code: 'order_session_mismatch',
  message: 'This order already has an open checkout with different terms. Use a new order_id for the new terms '
    + '(for example, include a cart version), or cancel the open checkout session first.',
};

it.each([
  ['a different amount', open({ amount: '50000000' }), ['amount']],
  ['redirect ui_mode', open({ ui_mode: 'redirect' }), ['ui_mode']],
  ['a different mode', open({ mode: 'subscription', interval: 'MONTH' }), ['mode']],
  ['several differences', open({ amount: '1', ui_mode: 'redirect' }), ['ui_mode', 'amount']],
])('answers 409 order_session_mismatch for an open session with %s, never cancels or reissues', async (_, session, fields) => {
  const { fianto, calls } = fakeFianto([{ status: 201, body: session }]);
  const onError = vi.fn();
  const response = await createCheckoutHandler({ fianto, createSession: async () => params, onError })(sameOrigin());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: MISMATCH });
  expect(calls.map((c) => c.path)).toEqual(['/v1/checkout-sessions']);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'order_session_mismatch', sessionId: 'fian_cs_1', fields }));
});

it('compares amounts as USDC base units, not strings', async () => {
  const { fianto } = fakeFianto([
    { status: 201, body: open({ amount: '10500000' }) },
    { status: 200, body: { id: 'fian_cs_1', url: 'https://pay.test/c/t2' } },
  ]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => ({ ...params, amount: '10.50' }) })(sameOrigin());
  expect(response.status).toBe(200);
});

const priced = {
  mode: 'subscription' as const, order_id: 'sub-1', price_id: 'fian_price_pro',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
const price = (patch: Record<string, unknown> = {}) => ({
  id: 'fian_price_pro', object: 'price', amount: '20000000', currency: 'USDC', interval: 'MONTH', type: 'RECURRING', status: 'ACTIVE', ...patch,
});

it('checks a price_id session against that price (the session does not echo price_id)', async () => {
  const { fianto, calls } = fakeFianto([
    { status: 201, body: open({ mode: 'subscription', amount: '20000000', interval: 'MONTH' }) },
    { status: 200, body: price() },
    { status: 200, body: { id: 'fian_cs_1', url: 'https://pay.test/c/t2' } },
  ]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => priced })(sameOrigin());
  expect(response.status).toBe(200);
  expect(calls.map((c) => c.path)).toEqual(['/v1/checkout-sessions', '/v1/prices/fian_price_pro', '/v1/checkout-sessions/fian_cs_1/link']);
});

it.each([
  ['amount', price({ amount: '10000000' })],
  ['interval', price({ interval: 'YEAR' })],
])('answers 409 when the open session differs from the price in %s', async (_, body) => {
  const { fianto, calls } = fakeFianto([
    { status: 201, body: open({ mode: 'subscription', amount: '20000000', interval: 'MONTH' }) },
    { status: 200, body },
  ]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => priced })(sameOrigin());
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe('order_session_mismatch');
  expect(calls).toHaveLength(2);
});

// C12: only codes the payer-facing UI can act on reach the browser, with the SDK's own words.
it('passes a 429 through at once with its retry-after, as rate_limited', async () => {
  const { fianto } = fakeFianto([
    { status: 429, body: { code: 'rate_limited', message: 'Slow down (upstream).' }, headers: { 'retry-after': '60' } },
  ]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(sameOrigin());
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('60');
  expect(await response.json()).toEqual({ error: { code: 'rate_limited', message: 'Too many checkout attempts. Try again in a moment.' } });
});

it('relays a validation code for the merchant\'s own params with an SDK-written message', async () => {
  const { fianto } = fakeFianto([{ status: 400, body: { code: 'url_insecure', message: 'upstream text', field: 'success_url' } }]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(sameOrigin());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: 'url_insecure', message: 'success_url and cancel_url must be https URLs.' } });
});

it.each([
  [409, 'idempotency_key_reused'],
  [409, 'subscription_preparing'],
  [503, 'subscription_busy'],
  [500, 'checkout_busy'],
  [500, 'internal_error'],
  [502, 'payment_in_progress'],
  [403, 'forbidden'],
])('turns HTTP %i %s into the generic 500, reporting the original to onError', async (status, code) => {
  const { fianto } = fakeFianto([{ status, body: { code, message: 'upstream secret detail' } }]);
  const onError = vi.fn();
  const response = await createCheckoutHandler({ fianto, createSession: async () => params, onError })(sameOrigin());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: 'internal_error', message: 'Checkout could not be started.' } });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status, code }));
});

// F22: a throwing onError never changes the response.
it('keeps the response when onError throws', async () => {
  const throwing = () => { throw new Error('logger down'); };
  const relayed = fakeFianto([{ status: 409, body: { code: 'order_already_paid', message: 'x' } }]);
  const r1 = await createCheckoutHandler({ fianto: relayed.fianto, createSession: async () => params, onError: throwing })(sameOrigin());
  expect(r1.status).toBe(409);
  const failing = fakeFianto([]);
  const r2 = await createCheckoutHandler({ fianto: failing.fianto, createSession: async () => { throw new Error('db'); }, onError: throwing })(sameOrigin());
  expect(r2.status).toBe(500);
});

// F11: the adapter's framework context reaches createSession.
it('passes the second handler argument to createSession as its context', async () => {
  const { fianto } = fakeFianto([{ status: 201, body: { id: 'fian_cs_1', url: 'https://pay.test/c/t1' } }]);
  const createSession = vi.fn(async (_request: Request, _context: { userId: string }) => params);
  const request = sameOrigin();
  await createCheckoutHandler({ fianto, createSession })(request, { userId: 'u_1' });
  expect(createSession).toHaveBeenCalledWith(request, { userId: 'u_1' });
});

// S1: a COMPLETED subscription checkout keeps its order_id; a new create for it can never succeed.
it('relays order_id_in_use as 409 with an SDK-written message', async () => {
  const { fianto } = fakeFianto([{ status: 409, body: { code: 'order_id_in_use', message: 'upstream', field: 'order_id' } }]);
  const onError = vi.fn();
  const response = await createCheckoutHandler({ fianto, createSession: async () => priced, onError })(sameOrigin());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: 'order_id_in_use', message: 'This order has already been checked out. Start a new order.' },
  });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 409, code: 'order_id_in_use' }));
});

// S3: the backend's 503 busy answers mean "nothing started, retry after Retry-After". The
// wording is the API's own (owner ruling 2026-10-06): starting a checkout never charges anything.
it.each([
  ['checkout_busy', '3', 'Payments are very busy right now. Nothing was charged. Try again in a few seconds.'],
  ['service_busy', '3', 'Fianto is very busy right now. Try again in a few seconds.'],
  ['subscriptions_paused', null, 'New subscriptions are paused right now. Try again later.'],
])('relays 503 %s with its retry-after once the client stops retrying', async (code, retryAfter, message) => {
  const headers: Record<string, string> = retryAfter ? { 'retry-after': retryAfter } : {};
  const { fianto } = fakeFianto([{ status: 503, body: { code, message: 'upstream' }, headers }]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(sameOrigin());
  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe(retryAfter);
  expect(await response.json()).toEqual({ error: { code, message } });
});

// S8: a merchant setup error is visible in development, without the wallet address.
it('relays merchant_token_account_missing without the upstream message', async () => {
  const { fianto } = fakeFianto([{ status: 422, body: { code: 'merchant_token_account_missing', message: 'Send any amount of USDC to Wa11et once' } }]);
  const response = await createCheckoutHandler({ fianto, createSession: async () => params })(sameOrigin());
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    error: { code: 'merchant_token_account_missing', message: "This shop's wallet cannot receive USDC yet." },
  });
});

// S2: create returns an order's OPEN session without checking its price; the payer page then
// refuses a new subscribe on an ended price. Never hand out a link for it.
it.each([
  ['subscription', priced, open({ mode: 'subscription', amount: '20000000', interval: 'MONTH' }), price({ status: 'ENDED' })],
  [
    'payment',
    { ...priced, mode: 'payment' as const, order_id: 'o-2' },
    open({ amount: '20000000' }),
    price({ status: 'ENDED', interval: null, type: 'ONE_TIME' }),
  ],
])('answers 422 price_ended for an open %s session whose price has ended, never reissuing', async (_, sent, session, body) => {
  const { fianto, calls } = fakeFianto([{ status: 201, body: session }, { status: 200, body }]);
  const onError = vi.fn();
  const response = await createCheckoutHandler({ fianto, createSession: async () => sent, onError })(sameOrigin());
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: { code: 'price_ended', message: 'That price has ended and cannot be sold.' } });
  expect(calls.map((c) => c.path)).toEqual(['/v1/checkout-sessions', '/v1/prices/fian_price_pro']);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'open_session_price_ended', sessionId: 'fian_cs_1', priceId: 'fian_price_pro' }));
  const error = onError.mock.calls[0]![0];
  expect(error).toBeInstanceOf(OpenSessionPriceEndedError);
  // Not an API response: it must never narrow to APIError through the API's own code.
  expect(isFiantoError(error, 'price_ended')).toBe(false);
  expect(isAPIError(error)).toBe(false);
  expect(isFiantoError(error, 'open_session_price_ended')).toBe(true);
});
