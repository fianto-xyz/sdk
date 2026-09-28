import { inspect } from 'node:util';
import { Fianto } from './client.js';
import { FiantoError } from './core/errors.js';

function client(responder: (url: URL, init: RequestInit) => unknown = () => ({})) {
  const calls: Array<{ method: string; url: URL; body: unknown; key: string | null; contentType: string | null }> = [];
  const fianto = new Fianto({
    appId: 'fian_app_1', appSecret: 'fian_sk_live_2', baseUrl: 'https://api.test',
    fetch: (async (input: string, init: RequestInit) => {
      const url = new URL(input);
      calls.push({
        method: init.method!, url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        key: new Headers(init.headers).get('idempotency-key'),
        contentType: new Headers(init.headers).get('content-type'),
      });
      return new Response(JSON.stringify(responder(url, init)), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { fianto, calls };
}

it.each([
  ['application.retrieve', (f: Fianto) => f.application.retrieve(), 'GET', '/v1/application'],
  ['checkoutSessions.retrieve', (f: Fianto) => f.checkoutSessions.retrieve('fian_cs_1'), 'GET', '/v1/checkout-sessions/fian_cs_1'],
  ['checkoutSessions.cancel', (f: Fianto) => f.checkoutSessions.cancel('fian_cs_1'), 'POST', '/v1/checkout-sessions/fian_cs_1/cancel'],
  ['checkoutSessions.reissueLink', (f: Fianto) => f.checkoutSessions.reissueLink('fian_cs_1'), 'POST', '/v1/checkout-sessions/fian_cs_1/link'],
  ['orders.retrieve', (f: Fianto) => f.orders.retrieve('fian_ord_1'), 'GET', '/v1/orders/fian_ord_1'],
  ['payments.retrieve', (f: Fianto) => f.payments.retrieve('fian_pay_1'), 'GET', '/v1/payments/fian_pay_1'],
  ['subscriptions.retrieve', (f: Fianto) => f.subscriptions.retrieve('fian_sub_1'), 'GET', '/v1/subscriptions/fian_sub_1'],
  ['products.retrieve', (f: Fianto) => f.products.retrieve('fian_prod_1'), 'GET', '/v1/products/fian_prod_1'],
  ['prices.retrieve', (f: Fianto) => f.prices.retrieve('fian_price_1'), 'GET', '/v1/prices/fian_price_1'],
  ['events.retrieve', (f: Fianto) => f.events.retrieve(`evt_${'a'.repeat(32)}`), 'GET', `/v1/events/evt_${'a'.repeat(32)}`],
  ['webhookEndpoint.sendTestEvent', (f: Fianto) => f.webhookEndpoint.sendTestEvent(), 'POST', '/v1/webhook/test-event'],
] as const)('%s calls the right route', async (_name, call, method, path) => {
  const { fianto, calls } = client();
  await call(fianto);
  expect(calls[0]).toMatchObject({ method });
  expect(calls[0]!.url.pathname).toBe(path);
  expect(calls[0]!.key !== null).toBe(method === 'POST');
});

it('creates a checkout session with the body as given', async () => {
  const { fianto, calls } = client(() => ({ id: 'fian_cs_1', url: 'https://pay.test/c/x' }));
  const params = {
    mode: 'payment', order_id: 'o-1', amount: '10', description: 'Coffee',
    success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
  } as const;
  const session = await fianto.checkoutSessions.create(params, { idempotencyKey: 'checkout:o-1' });
  expect(session.id).toBe('fian_cs_1');
  expect(calls[0]).toMatchObject({ method: 'POST', body: params, key: 'checkout:o-1' });
});

it('looks orders up by the merchant order id', async () => {
  const { fianto, calls } = client();
  await fianto.orders.retrieveByOrderId('shop 9/1');
  expect(calls[0]!.url.pathname).toBe('/v1/orders/lookup');
  expect(calls[0]!.url.searchParams.get('order_id')).toBe('shop 9/1');
});

it('cancels a subscription with its body', async () => {
  const { fianto, calls } = client();
  await fianto.subscriptions.cancel('fian_sub_1', { at: 'period_end' });
  expect(calls[0]).toMatchObject({ method: 'POST', body: { at: 'period_end' } });
});

// A JS caller (no compiler) who means the LAST argument (`options`) but puts it in the params
// slot instead must get a clear throw, never a request silently missing the option they set.
describe('retrieve/cancel/list refuse a RequestOptions key passed as params', () => {
  it.each([
    // `list()` isn't `async`, so it throws synchronously; `retrieve`/`cancel` are `async`, so
    // the same throw surfaces as a rejected promise — wrapping every case in an async function
    // normalises both to a rejection this test can assert on the same way.
    ['orders.retrieve', async (f: Fianto) => { await f.orders.retrieve('fian_ord_1', { idempotencyKey: 'x' } as any); }],
    ['payments.retrieve', async (f: Fianto) => { await f.payments.retrieve('fian_pay_1', { timeoutMs: 5000 } as any); }],
    ['products.list', async (f: Fianto) => { f.products.list({ signal: new AbortController().signal } as any); }],
    ['orders.list', async (f: Fianto) => { f.orders.list({ maxRetries: 0 } as any); }],
    ['subscriptions.cancel', async (f: Fianto) => { await f.subscriptions.cancel('fian_sub_1', { at: 'period_end', idempotencyKey: 'x' } as any); }],
    ['checkoutSessions.cancel', async (f: Fianto) => { await f.checkoutSessions.cancel('fian_cs_1', { timeoutMs: 1000 } as any); }],
  ] as const)('%s throws instead of sending the option as params', async (_name, call) => {
    const { fianto, calls } = client();
    await expect(call(fianto)).rejects.toThrow(FiantoError);
    expect(calls).toHaveLength(0);
  });

  it('still works normally once the option moves to the actual options argument', async () => {
    const { fianto, calls } = client();
    await fianto.orders.retrieve('fian_ord_1', {}, { idempotencyKey: 'x' });
    expect(calls[0]).toMatchObject({ method: 'GET' });
  });
});

it('pages a list with its filters and the cursor', async () => {
  const { fianto, calls } = client((url) =>
    url.searchParams.get('cursor') === null
      ? { items: [{ id: 'a' }], next_cursor: 7 }
      : { items: [{ id: 'b' }], next_cursor: null });
  const ids: string[] = [];
  for await (const order of fianto.orders.list({ status: 'PAID', limit: 1 })) ids.push(order.id);
  expect(ids).toEqual(['a', 'b']);
  expect(calls.map((c) => c.url.search)).toEqual(['?status=PAID&limit=1', '?status=PAID&limit=1&cursor=7']);
});

// Review Focus (F7/A7): nothing before this proved a resource's list() actually CALLS
// `stringifyCursor` at runtime — every check so far was type-level (`types.test-d.ts`), and a
// resource that dropped `.then(stringifyCursor)` while still declaring `PagePromise<Order>` as
// its return type would fail to compile ONLY if the raw wire shape leaked into a place its
// declared type disagreed with, which a same-shaped `any`/unchecked cast could still slip past.
// These assert what actually lands in the caller's hands: the wire number 7 must actually BE
// the string '7' on the resolved page, not merely typed as one.
describe('list() normalises a numeric wire cursor to a string, not just at the type level (F7/A7)', () => {
  it.each([
    ['orders', (f: Fianto) => f.orders.list()],
    ['subscriptions', (f: Fianto) => f.subscriptions.list()],
  ] as const)('%s.list()\'s next_cursor is the string "7" for a wire next_cursor of 7', async (_name, list) => {
    const { fianto } = client(() => ({ items: [{ id: 'a' }], next_cursor: 7 }));
    const page = await list(fianto);
    expect(page.next_cursor).toBe('7');
    expect(typeof page.next_cursor).toBe('string');
  });

  it('list({ cursor: page.next_cursor }) sends the normalised string back as ?cursor=7', async () => {
    const { fianto, calls } = client(() => ({ items: [{ id: 'a' }], next_cursor: 7 }));
    const page = await fianto.orders.list();
    await fianto.orders.list({ cursor: page.next_cursor! });
    expect(calls[1]!.url.search).toBe('?cursor=7');
  });
});

// Review Focus (F6): a reserved, currently-empty `params` slot on cancel/reissueLink/
// sendTestEvent must reach the wire as no body at all (not an empty `{}`), or an idempotency
// key replayed across an SDK upgrade would hash a different body and see a spurious
// idempotency_key_reused instead of its stored response.
describe('a reserved params slot with nothing in it sends no body (F6)', () => {
  it.each([
    ['checkoutSessions.cancel', (f: Fianto) => f.checkoutSessions.cancel('fian_cs_1')],
    ['checkoutSessions.reissueLink', (f: Fianto) => f.checkoutSessions.reissueLink('fian_cs_1')],
    ['webhookEndpoint.sendTestEvent', (f: Fianto) => f.webhookEndpoint.sendTestEvent()],
  ] as const)('%s sends no body and sets no content-type when params is left empty', async (_name, call) => {
    const { fianto, calls } = client();
    await call(fianto);
    expect(calls[0]!.body).toBeUndefined();
    expect(calls[0]!.contentType).toBeNull();
  });
});

// Review Focus (F9): a malformed id rejects the returned promise instead of throwing
// synchronously, so `Promise.allSettled([...])` over a batch of calls never throws.
it('refuses a malformed id with a rejected promise, not a synchronous throw', async () => {
  const { fianto, calls } = client();
  let threw = false;
  let call: Promise<unknown>;
  try {
    call = fianto.orders.retrieve('../admin');
  } catch {
    threw = true;
    call = Promise.resolve();
  }
  expect(threw).toBe(false);
  await expect(call).rejects.toThrow(FiantoError);
  expect(calls).toHaveLength(0);
});

// Review Focus (C3): the app secret (and anything derived from it) must never be reachable
// through JSON.stringify, util.inspect or String() on the client or any resource.
describe('never leaks the app secret through reflection', () => {
  const SECRET = 'fian_sk_live_2';

  it('JSON.stringify(client)', () => {
    const { fianto } = client();
    expect(JSON.stringify(fianto)).not.toContain(SECRET);
  });

  it('JSON.stringify(client.orders)', () => {
    const { fianto } = client();
    expect(JSON.stringify(fianto.orders)).not.toContain(SECRET);
  });

  it('util.inspect(client)', () => {
    const { fianto } = client();
    expect(inspect(fianto, { depth: null })).not.toContain(SECRET);
  });

  it('util.inspect(client.orders)', () => {
    const { fianto } = client();
    expect(inspect(fianto.orders, { depth: null })).not.toContain(SECRET);
  });

  it('String(client)', () => {
    const { fianto } = client();
    expect(String(fianto)).not.toContain(SECRET);
    expect(`${fianto}`).not.toContain(SECRET);
  });
});
