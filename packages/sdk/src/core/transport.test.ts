import { ConnectionError, InvalidRequestError, RateLimitError, TimeoutError } from './errors.js';
import { resolveConfig } from './config.js';
import { Transport } from './transport.js';

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

const err = (code: string) => ({ statusCode: 0, error: 'X', code, message: code, request_id: 'req_12345678' });

it('sends auth, user agent, request id and JSON', async () => {
  const { transport, calls, header } = setup([json(200, { ok: 1 })]);
  const result = await transport.request({ method: 'GET', path: '/v1/orders', query: { limit: 5, cursor: undefined } });
  expect(result).toEqual({ ok: 1 });
  expect(calls[0]!.url).toBe('https://api.test/v1/orders?limit=5');
  expect(header(0, 'authorization')).toBe(`Basic ${btoa('fian_app_1:fian_sk_live_2')}`);
  expect(header(0, 'user-agent')).toMatch(/^fianto-sdk\/0\.1\.0 /);
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

it('honours Retry-After, capped at 60 s', async () => {
  const { transport, sleeps } = setup([
    json(409, err('checkout_unavailable'), { 'retry-after': '5' }),
    json(429, err('rate_limited'), { 'retry-after': '600' }),
    json(200, {}),
  ]);
  await transport.request({ method: 'POST', path: '/v1/x', body: {} });
  expect(sleeps).toEqual([5_000, 60_000]);
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

it('turns a timeout into TimeoutError and a caller abort into an immediate rejection', async () => {
  const timeout = setup([new DOMException('timed out', 'TimeoutError'), new DOMException('timed out', 'TimeoutError'), new DOMException('timed out', 'TimeoutError')]);
  await expect(timeout.transport.request({ method: 'GET', path: '/v1/x' })).rejects.toBeInstanceOf(TimeoutError);

  const controller = new AbortController();
  controller.abort();
  const aborted = setup([new DOMException('aborted', 'AbortError')]);
  await expect(aborted.transport.request({ method: 'GET', path: '/v1/x' }, { signal: controller.signal })).rejects.toThrow(/abort/i);
  expect(aborted.calls).toHaveLength(1);
});

it('refuses an invalid idempotency key before sending anything', async () => {
  const { transport, calls } = setup([]);
  await expect(transport.request({ method: 'POST', path: '/v1/x', body: {} }, { idempotencyKey: 'has space' })).rejects.toThrow(/Idempotency-Key/);
  expect(calls).toHaveLength(0);
});
