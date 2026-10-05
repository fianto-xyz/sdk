import { AbortError, ConnectionError, FiantoError, InvalidRequestError, RateLimitError, TimeoutError } from './errors.js';
import { resolveConfig } from './config.js';
import { Transport } from './transport.js';
import { VERSION } from '../version.js';

type Call = { url: string; init: RequestInit };

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function setup(responses: Array<Response | Error>, options: { maxRetries?: number } = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof globalThis.fetch;
  const config = resolveConfig({
    appId: 'fian_app_1', appSecret: 'fian_sk_live_2', baseUrl: 'https://api.test', fetch, ...options,
  });
  const transport = new Transport(config, {
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0.5,
    now: () => Date.parse('2026-09-28T10:00:00Z'),
  });
  const header = (i: number, name: string) => new Headers(calls[i]!.init.headers).get(name);
  return { transport, calls, sleeps, header };
}

/**
 * A `fetch` that never settles on its own — it only rejects when its `signal` aborts, with the
 * signal's abort reason (as any spec-compliant fetch would). Used to exercise a *real* elapsed
 * timeout (our own `timeoutSignal()` actually firing after `timeoutMs`), rather than a canned
 * `DOMException` a mock throws regardless of whether any signal ever aborted.
 */
function setupHanging(options: { maxRetries?: number } = {}) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    });
  }) as unknown as typeof globalThis.fetch;
  const config = resolveConfig({
    appId: 'fian_app_1', appSecret: 'fian_sk_live_2', baseUrl: 'https://api.test', fetch, ...options,
  });
  const transport = new Transport(config);
  const header = (i: number, name: string) => new Headers(calls[i]!.init.headers).get(name);
  return { transport, calls, header };
}

const err = (code: string) => ({ statusCode: 0, error: 'X', code, message: code, request_id: 'req_12345678' });

it('sends auth, user agent, request id and JSON', async () => {
  const { transport, calls, header } = setup([json(200, { ok: 1 })]);
  const result = await transport.request({ method: 'GET', path: '/v1/orders', query: { limit: 5, cursor: undefined } });
  expect(result).toEqual({ ok: 1 });
  expect(calls[0]!.url).toBe('https://api.test/v1/orders?limit=5');
  expect(header(0, 'authorization')).toBe(`Basic ${btoa('fian_app_1:fian_sk_live_2')}`);
  expect(header(0, 'user-agent')).toMatch(new RegExp(`^fianto-sdk/${VERSION.replaceAll('.', '\\.')} `));
  expect(header(0, 'x-request-id')).toMatch(/^req_[0-9a-f]{32}$/);
  expect(header(0, 'idempotency-key')).toBeNull();
});

// Review Focus 1: the same Idempotency-Key and X-Request-Id on every attempt of one call.
it('retries a POST with the same Idempotency-Key and request id', async () => {
  const { transport, calls, header } = setup([
    new TypeError('fetch failed'),
    json(503, err('subscription_busy')),
    json(201, { id: 'fian_cs_1' }),
  ]);
  const result = await transport.request({ method: 'POST', path: '/v1/checkout-sessions', body: { a: 1 } });
  expect(result).toEqual({ id: 'fian_cs_1' });
  expect(calls).toHaveLength(3);
  const keys = [0, 1, 2].map((i) => header(i, 'idempotency-key'));
  expect(new Set(keys).size).toBe(1);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(new Set([0, 1, 2].map((i) => header(i, 'x-request-id'))).size).toBe(1);
  expect(calls[0]!.init.body).toBe('{"a":1}');
  expect(header(0, 'content-type')).toBe('application/json');
});

it('uses a caller-supplied idempotency key', async () => {
  const { transport, header } = setup([json(200, {})]);
  await transport.request({ method: 'POST', path: '/v1/x', body: {} }, { idempotencyKey: 'checkout:o-1' });
  expect(header(0, 'idempotency-key')).toBe('checkout:o-1');
});

it('honours a Retry-After at or under the 10 s cap', async () => {
  const { transport, sleeps } = setup([
    json(409, err('checkout_unavailable'), { 'retry-after': '5' }),
    json(429, err('rate_limited'), { 'retry-after': '2' }),
    json(200, {}),
  ]);
  await transport.request({ method: 'POST', path: '/v1/x', body: {} });
  expect(sleeps).toEqual([5_000, 2_000]);
});

// A2: a Retry-After longer than the cap is never waited on — one attempt, thrown at once.
it('throws at once, with no retry, when Retry-After exceeds the 10 s cap', async () => {
  const { transport, calls, sleeps } = setup([json(429, err('rate_limited'), { 'retry-after': '3600' })]);
  await expect(transport.request({ method: 'GET', path: '/v1/x' })).rejects.toMatchObject({
    code: 'rate_limited', retryAfterSeconds: 3600,
  });
  expect(calls).toHaveLength(1);
  expect(sleeps).toEqual([]);
});

// A2: a Retry-After of exactly 2 s is honoured and retried after waiting it out.
it('retries after honouring a 2 s Retry-After', async () => {
  const { transport, calls, sleeps } = setup([
    json(429, err('rate_limited'), { 'retry-after': '2' }),
    json(200, { ok: true }),
  ]);
  await expect(transport.request({ method: 'GET', path: '/v1/x' })).resolves.toEqual({ ok: true });
  expect(calls).toHaveLength(2);
  expect(sleeps).toEqual([2_000]);
});

it('backs off exponentially with jitter when there is no Retry-After', async () => {
  const { transport, sleeps } = setup([json(500, err('internal_error')), json(502, 'bad'), json(200, {})]);
  await transport.request({ method: 'GET', path: '/v1/x' });
  expect(sleeps).toEqual([500, 1_000]); // random() = 0.5 → factor 1.0
});

it('does not retry a non-retryable 409 or any 4xx', async () => {
  const { transport, calls } = setup([json(409, err('payment_in_progress'))]);
  await expect(transport.request({ method: 'POST', path: '/v1/x', body: {} })).rejects.toMatchObject({ code: 'payment_in_progress' });
  expect(calls).toHaveLength(1);
  const second = setup([json(422, err('idempotency_key_reused'))]);
  await expect(second.transport.request({ method: 'POST', path: '/v1/x', body: {} })).rejects.toBeInstanceOf(InvalidRequestError);
  expect(second.calls).toHaveLength(1);
});

// S9: plan_limit_reached is a per-day cap (no Retry-After): retrying within a call cannot help.
it('does not retry a 429 plan_limit_reached', async () => {
  const { transport, calls, sleeps } = setup([json(429, err('plan_limit_reached')), json(200, {})]);
  await expect(transport.request({ method: 'POST', path: '/v1/x', body: {} })).rejects.toMatchObject({ code: 'plan_limit_reached' });
  expect(calls).toHaveLength(1);
  expect(sleeps).toEqual([]);
});

// Review fix 6: subscriptions_paused is a switch that flips only on a restart: retrying is pointless.
it('does not retry a 503 subscriptions_paused, but still retries other 503s', async () => {
  const { transport, calls, sleeps } = setup([json(503, err('subscriptions_paused')), json(200, {})]);
  await expect(transport.request({ method: 'POST', path: '/v1/x', body: {} })).rejects.toMatchObject({ code: 'subscriptions_paused' });
  expect(calls).toHaveLength(1);
  expect(sleeps).toEqual([]);
  const busy = setup([json(503, err('checkout_busy'), { 'retry-after': '3' }), json(200, { ok: true })]);
  await expect(busy.transport.request({ method: 'POST', path: '/v1/x', body: {} })).resolves.toEqual({ ok: true });
  expect(busy.sleeps).toEqual([3_000]);
});

it('retries idempotency_request_in_progress', async () => {
  const { transport, calls } = setup([json(409, err('idempotency_request_in_progress')), json(200, { ok: true })]);
  await expect(transport.request({ method: 'POST', path: '/v1/x', body: {} })).resolves.toEqual({ ok: true });
  expect(calls).toHaveLength(2);
});

it('gives up after maxRetries and throws the last error', async () => {
  const { transport, calls } = setup([json(429, err('rate_limited')), json(429, err('rate_limited')), json(429, err('rate_limited'))]);
  await expect(transport.request({ method: 'GET', path: '/v1/x' })).rejects.toBeInstanceOf(RateLimitError);
  expect(calls).toHaveLength(3);
});

it('respects maxRetries: 0', async () => {
  const { transport, calls } = setup([new TypeError('fetch failed')], { maxRetries: 0 });
  await expect(transport.request({ method: 'GET', path: '/v1/x' })).rejects.toBeInstanceOf(ConnectionError);
  expect(calls).toHaveLength(1);
});

// Detected via OUR OWN timeout signal actually firing (a real elapsed setTimeout), not via the
// failure's `.name` — a runtime's own abort/network error could coincidentally be named
// 'TimeoutError' for an unrelated reason, so a canned mock throwing that name proves nothing.
it('turns a real elapsed timeout into TimeoutError', async () => {
  const { transport } = setupHanging({ maxRetries: 0 });
  const error = await transport.request({ method: 'GET', path: '/v1/x' }, { timeoutMs: 5 }).catch((e) => e);
  expect(error).toBeInstanceOf(TimeoutError);
});

it('turns a caller abort into an immediate rejection', async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = setup([new DOMException('aborted', 'AbortError')]);
  await expect(aborted.transport.request({ method: 'GET', path: '/v1/x' }, { signal: controller.signal })).rejects.toThrow(/abort/i);
  expect(aborted.calls).toHaveLength(1);
});

// F17: a user abort rejects with a FiantoError subclass carrying the abort reason as `cause`.
it('rejects a caller abort with AbortError, code aborted, cause = the abort reason', async () => {
  const reason = new Error('user cancelled');
  const controller = new AbortController();
  controller.abort(reason);
  const { transport } = setup([new DOMException('aborted', 'AbortError')]);
  const error = await transport.request({ method: 'GET', path: '/v1/x' }, { signal: controller.signal }).catch((e) => e);
  expect(error).toBeInstanceOf(AbortError);
  expect(error).toBeInstanceOf(FiantoError);
  expect(error.code).toBe('aborted');
  expect(error.cause).toBe(reason);
});

// F17 corollary: aborting mid-retry-wait also rejects with AbortError, not the raw reason.
it('rejects with AbortError when the caller aborts during a retry wait', async () => {
  const reason = new Error('user cancelled mid-retry');
  const controller = new AbortController();
  const responses = [json(500, err('internal_error')), json(200, {})];
  const fetch = (async () => responses.shift()!) as unknown as typeof globalThis.fetch;
  const config = resolveConfig({ appId: 'fian_app_1', appSecret: 'fian_sk_live_2', baseUrl: 'https://api.test', fetch });
  const transport = new Transport(config, {
    random: () => 0.5,
    now: () => Date.now(),
    sleep: async (_ms, signal) => {
      controller.abort(reason);
      if (signal?.aborted) throw signal.reason;
    },
  });
  const error = await transport.request({ method: 'GET', path: '/v1/x' }, { signal: controller.signal }).catch((e) => e);
  expect(error).toBeInstanceOf(AbortError);
  expect(error.cause).toBe(reason);
});

// F3: the transport must not depend on AbortSignal.any (missing on some Edge runtimes).
it('combines signals without AbortSignal.any', async () => {
  const original = AbortSignal.any;
  // @ts-expect-error -- simulating a runtime without AbortSignal.any
  delete AbortSignal.any;
  try {
    const { transport, calls } = setup([json(200, { ok: 1 })]);
    const controller = new AbortController();
    await expect(transport.request({ method: 'GET', path: '/v1/x' }, { signal: controller.signal })).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(1);
  } finally {
    AbortSignal.any = original;
  }
});

// F3: a signal that is already aborted when the request starts still short-circuits.
it('rejects immediately when the caller signal is already aborted, without AbortSignal.any', async () => {
  const original = AbortSignal.any;
  // @ts-expect-error -- simulating a runtime without AbortSignal.any
  delete AbortSignal.any;
  try {
    const controller = new AbortController();
    controller.abort(new Error('already gone'));
    const { transport, calls } = setup([new DOMException('aborted', 'AbortError')]);
    const error = await transport.request({ method: 'GET', path: '/v1/x' }, { signal: controller.signal }).catch((e) => e);
    expect(error).toBeInstanceOf(AbortError);
    expect(calls).toHaveLength(1);
  } finally {
    AbortSignal.any = original;
  }
});

// C10/F10/CRITICAL: every fetch refuses to follow a redirect; a redirect surfaces as a network
// failure, never as a silently-followed request (which could turn a POST into a GET on another
// host) — with redirect: 'manual', not 'error' ('error' throws a TypeError while *constructing*
// the request on Cloudflare Workers/workerd, before there's even a response to classify, which
// would fail every request there).
it('refuses a 302: redirect: manual, throws at once, never retries', async () => {
  const { transport, calls } = setup([json(302, {}, { location: 'https://elsewhere.test/' })]);
  const error = await transport.request({ method: 'GET', path: '/v1/x' }).catch((e) => e);
  expect(error).toBeInstanceOf(ConnectionError);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.init.redirect).toBe('manual');
});

// Regression guard: 'error' throws while constructing the request on workerd — this proves the
// transport never sends it again, whatever the response ends up being.
it('never passes redirect: error to fetch', async () => {
  const fetch = (async (_url: string, init: RequestInit) => {
    if (init.redirect === 'error') {
      throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
    }
    return json(200, { ok: 1 });
  }) as unknown as typeof globalThis.fetch;
  const config = resolveConfig({ appId: 'fian_app_1', appSecret: 'fian_sk_live_2', baseUrl: 'https://api.test', fetch });
  const transport = new Transport(config);
  await expect(transport.request({ method: 'GET', path: '/v1/x' })).resolves.toEqual({ ok: 1 });
});

it('refuses an invalid idempotency key before sending anything', async () => {
  const { transport, calls } = setup([]);
  await expect(transport.request({ method: 'POST', path: '/v1/x', body: {} }, { idempotencyKey: 'has space' })).rejects.toThrow(/Idempotency-Key/);
  expect(calls).toHaveLength(0);
});

it('refuses an invalid per-request maxRetries or timeoutMs before sending anything', async () => {
  const { transport, calls } = setup([]);
  await expect(transport.request({ method: 'GET', path: '/v1/x' }, { maxRetries: Number.NaN })).rejects.toThrow(/maxRetries/);
  await expect(transport.request({ method: 'GET', path: '/v1/x' }, { maxRetries: 11 })).rejects.toThrow(/maxRetries/);
  await expect(transport.request({ method: 'GET', path: '/v1/x' }, { timeoutMs: 0 })).rejects.toThrow(/timeoutMs/);
  await expect(transport.request({ method: 'GET', path: '/v1/x' }, { timeoutMs: 600_001 })).rejects.toThrow(/timeoutMs/);
  expect(calls).toHaveLength(0);
});

// Review Focus 1 corollary: a body-read failure is a network failure too, or a lost create response can never recover.
it('retries when the response body fails to read, then throws ConnectionError once retries are exhausted', async () => {
  const brokenBody = () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError('terminated')); },
  }), { status: 200 });
  const { transport, calls } = setup([brokenBody(), brokenBody(), brokenBody()]);
  await expect(transport.request({ method: 'GET', path: '/v1/x' })).rejects.toBeInstanceOf(ConnectionError);
  expect(calls).toHaveLength(3);
});

it('recovers a POST from a body-read failure using the same Idempotency-Key', async () => {
  const brokenBody = () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError('terminated')); },
  }), { status: 200 });
  const { transport, calls, header } = setup([brokenBody(), json(201, { id: 'fian_cs_1' })]);
  const result = await transport.request({ method: 'POST', path: '/v1/x', body: { a: 1 } });
  expect(result).toEqual({ id: 'fian_cs_1' });
  expect(calls).toHaveLength(2);
  expect(header(0, 'idempotency-key')).toBe(header(1, 'idempotency-key'));
});

it('attaches requestId and idempotencyKey to a network failure after giving up', async () => {
  const { transport, header } = setup([new TypeError('fetch failed')], { maxRetries: 0 });
  const error = await transport.request({ method: 'POST', path: '/v1/x', body: {} }, { idempotencyKey: 'k-1' }).catch((e) => e);
  expect(error).toBeInstanceOf(ConnectionError);
  expect(error.idempotencyKey).toBe('k-1');
  expect(error.requestId).toBe(header(0, 'x-request-id'));
  const t = setupHanging({ maxRetries: 0 });
  const timeout = await t.transport.request({ method: 'GET', path: '/v1/x' }, { timeoutMs: 5 }).catch((e) => e);
  expect(timeout).toBeInstanceOf(TimeoutError);
  expect(timeout.requestId).toBe(t.header(0, 'x-request-id'));
  expect(timeout.idempotencyKey).toBeUndefined();
});

it('throws FiantoError on a 2xx whose body is not JSON', async () => {
  const { transport } = setup([new Response('<html>ok</html>', { status: 200 })]);
  const error = await transport.request({ method: 'GET', path: '/v1/x' }).catch((e) => e);
  expect(error).toBeInstanceOf(FiantoError);
});

it('sends an identical body and caller key on every attempt', async () => {
  const { transport, calls, header } = setup([json(500, err('internal_error')), new TypeError('fetch failed'), json(200, {})]);
  await transport.request({ method: 'POST', path: '/v1/x', body: { a: 1, b: [2] } }, { idempotencyKey: 'mine-1' });
  expect(calls.map((c) => c.init.body)).toEqual(Array(3).fill('{"a":1,"b":[2]}'));
  expect([0, 1, 2].map((i) => header(i, 'idempotency-key'))).toEqual(['mine-1', 'mine-1', 'mine-1']);
});

it('honours an HTTP-date Retry-After against deps.now', async () => {
  const { transport, sleeps } = setup([json(503, err('x'), { 'retry-after': 'Mon, 28 Sep 2026 10:00:07 GMT' }), json(200, {})]);
  await transport.request({ method: 'GET', path: '/v1/x' });
  expect(sleeps).toEqual([7_000]);
});

it('retries 408, and 409 checkout_unavailable without Retry-After with backoff', async () => {
  const { transport, calls, sleeps } = setup([json(408, err('request_timeout')), json(409, err('checkout_unavailable')), json(200, {})]);
  await transport.request({ method: 'POST', path: '/v1/x', body: {} });
  expect(calls).toHaveLength(3);
  expect(sleeps).toEqual([500, 1_000]);
});

it('removes its abort listener when the default sleep timer fires', async () => {
  const config = resolveConfig({
    appId: 'fian_app_1', appSecret: 'fian_sk_live_2', baseUrl: 'https://api.test', maxRetries: 1,
    fetch: (() => { let n = 0; return async () => (n++ === 0 ? json(503, err('x'), { 'retry-after': '0' }) : json(200, {})); })() as unknown as typeof fetch,
  });
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  await new Transport(config).request({ method: 'GET', path: '/v1/x' }, { signal: controller.signal });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
