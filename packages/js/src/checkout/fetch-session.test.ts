// @vitest-environment jsdom
import { CheckoutSessionError, fetchCheckoutSession, InvalidSessionError } from '../index.js';

const SESSION = { id: 'fian_cs_1', url: 'https://pay.fianto.test/c/fian_cst_x' };

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('POSTs a JSON body same-origin and returns { id, url }', async () => {
  const fetchMock = respond(200, SESSION);
  await expect(fetchCheckoutSession('/api/checkout', { body: { orderId: 'o_1' } })).resolves.toEqual(SESSION);
  const [endpoint, init] = fetchMock.mock.calls[0]!;
  expect(endpoint).toBe('/api/checkout');
  expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"orderId":"o_1"}' });
  expect(new Headers(init!.headers).get('content-type')).toBe('application/json');
});

it('sends {} by default and keeps caller headers and options', async () => {
  const fetchMock = respond(200, SESSION);
  await fetchCheckoutSession('/api/checkout', { headers: { 'x-cart': 'v2' }, credentials: 'include' });
  const init = fetchMock.mock.calls[0]![1]!;
  expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: '{}' });
  expect(new Headers(init.headers).get('x-cart')).toBe('v2');
});

// D3: a 409 must reach the caller as its own code, never as invalid_session.
it.each([
  [409, 'payment_in_progress'],
  [409, 'order_session_mismatch'],
  [409, 'order_already_paid'],
  [400, 'validation_failed'],
  [403, 'forbidden_origin'],
  [500, 'internal_error'],
])('maps a %i %s body to a CheckoutSessionError', async (status, code) => {
  respond(status, { error: { code, message: 'route message' } });
  const error = await fetchCheckoutSession('/api/checkout').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CheckoutSessionError);
  expect(error).toMatchObject({ code, message: 'route message', status, retryAfter: undefined });
});

it('carries Retry-After in seconds (delta-seconds or an HTTP date)', async () => {
  respond(429, { error: { code: 'rate_limited', message: 'm' } }, { 'retry-after': '30' });
  await expect(fetchCheckoutSession('/x')).rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfter: 30 });

  vi.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z') });
  respond(409, { error: { code: 'checkout_unavailable', message: 'm' } }, { 'retry-after': 'Mon, 28 Sep 2026 12:00:10 GMT' });
  await expect(fetchCheckoutSession('/x')).rejects.toMatchObject({ code: 'checkout_unavailable', retryAfter: 10 });

  respond(429, { error: { code: 'rate_limited', message: 'm' } }, { 'retry-after': 'soon' });
  await expect(fetchCheckoutSession('/x')).rejects.toMatchObject({ retryAfter: undefined });
});

it('names an error status with no error body session_request_failed', async () => {
  respond(502, '<html>Bad gateway</html>');
  await expect(fetchCheckoutSession('/x')).rejects.toMatchObject({ code: 'session_request_failed', status: 502 });
});

it('names a request that never got a response network_error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  await expect(fetchCheckoutSession('/x')).rejects.toMatchObject({ name: 'CheckoutSessionError', code: 'network_error' });
});

it('rethrows an abort from the caller as is', async () => {
  const controller = new AbortController();
  controller.abort();
  const abort = new DOMException('aborted', 'AbortError');
  vi.stubGlobal('fetch', vi.fn(async () => { throw abort; }));
  await expect(fetchCheckoutSession('/x', { signal: controller.signal })).rejects.toBe(abort);
});

// The `fetch()` call itself can resolve (headers arrived) before an abort cuts off the body
// read that follows — that rejection must surface as the caller's own abort, not get swallowed
// into a misleading InvalidSessionError/session_request_failed the way any other bad body would.
it('rethrows an abort that cuts off the response body read, not InvalidSessionError', async () => {
  const controller = new AbortController();
  const abort = new DOMException('aborted', 'AbortError');
  const fakeResponse = {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => {
      controller.abort();
      return Promise.reject(abort);
    },
  } as unknown as Response;
  vi.stubGlobal('fetch', vi.fn(async () => fakeResponse));
  await expect(fetchCheckoutSession('/x', { signal: controller.signal })).rejects.toBe(abort);
});

it.each([
  ['a body that is not { id, url }', { ok: true }],
  ['an insecure url', { id: 'fian_cs_1', url: 'http://pay.fianto.test/c/x' }],
  ['no JSON', 'not json'],
])('rejects InvalidSessionError for a 200 with %s', async (_name, body) => {
  respond(200, body);
  await expect(fetchCheckoutSession('/x')).rejects.toBeInstanceOf(InvalidSessionError);
});
