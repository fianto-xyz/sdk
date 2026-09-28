# @fianto/sdk

The server-side SDK for [fianto](https://fianto.xyz): a typed API client, Standard Webhooks
verification, and framework-agnostic route handlers for Solana USDC payments (hosted checkout,
one-time payments, subscriptions).

```bash
pnpm add @fianto/sdk
```

**Requirements:** Node.js ≥ 20.3, or Bun, Deno, Cloudflare Workers, Vercel Edge — anywhere with
`fetch` and Web Crypto. There are no Node-only APIs in the request path.

This package holds your app secret and must run on your server. For the browser side (opening
checkout from a page), see `@fianto/js`.

## Quickstart

```ts
import { Fianto } from '@fianto/sdk';

export async function createCheckoutSession(): Promise<Response | undefined> {
  // Reads FIANTO_APP_ID, FIANTO_APP_SECRET from the environment (FIANTO_BASE_URL is optional).
  const fianto = new Fianto();

  const session = await fianto.checkoutSessions.create({
    mode: 'payment',
    order_id: 'order_1001', // your own id — unique per attempt
    amount: '10.00', // USDC, decimal string
    description: 'Order order_1001', // required alongside amount — omit only with price_id
    success_url: 'https://shop.example/thank-you',
    cancel_url: 'https://shop.example/cart',
  });

  // session.url is the hosted payment link. Redirect the browser to it, or hand it to a popup.
  if (session.url) {
    return Response.redirect(session.url, 303);
  }
}
```

Never fulfil an order from this response alone — see [Money safety](#money-safety).

## Configuration

```ts no-check
new Fianto({
  appId, // default: process.env.FIANTO_APP_ID
  appSecret, // default: process.env.FIANTO_APP_SECRET — server-side only
  baseUrl, // default: process.env.FIANTO_BASE_URL, else https://api.fianto.xyz
  timeoutMs: 30_000,
  maxRetries: 2,
  fetch, // optional custom fetch
  dangerouslyAllowBrowser: false,
});
```

| Option | Env var | Default | Notes |
|---|---|---|---|
| `appId` | `FIANTO_APP_ID` | — (required) | |
| `appSecret` | `FIANTO_APP_SECRET` | — (required) | Never send to a browser. |
| `baseUrl` | `FIANTO_BASE_URL` | `https://api.fianto.xyz` | The production fianto API. Override it to point at your own self-hosted deployment or a backend running locally, e.g. `http://localhost:3000`. Must be `https://`; `http://` is only accepted for `localhost`, `127.0.0.1` and `[::1]`. There is no separate "devnet" API host to switch to — the Solana cluster a deployment settles against (devnet vs. mainnet-beta) is that backend's own configuration, not something `baseUrl` selects. |
| `timeoutMs` | — | `30_000` | Per attempt, not per call. |
| `maxRetries` | — | `2` | Retries after the first attempt, 0–10. |
| `fetch` | — | the global `fetch` | Override for custom networking or testing. |
| `dangerouslyAllowBrowser` | — | `false` | Constructing `Fianto` in a browser page (`window`/`document` exist) or a browser Web Worker (`importScripts` exists) throws unless this is `true`. There is no publishable/browser-safe key: the merchant's server always creates checkout sessions (see [Checkout route](#checkout-route)). |

A missing `appId` or `appSecret` throws a `FiantoError` at construction, naming the option and
the env var to set. `baseUrl` needs neither: it falls back to the production API.

Get `appId`/`appSecret` from **Dashboard → Developers → Applications**: your app, then "Reveal"
the secret.

## Resources

`opts` on write methods: `{ idempotencyKey?: string; timeoutMs?: number; signal?: AbortSignal; maxRetries?: number }`.

| Method | Route |
|---|---|
| `fianto.application.retrieve(opts?)` | `GET v1/application` |
| `fianto.checkoutSessions.create(params, opts?)` | `POST v1/checkout-sessions` |
| `fianto.checkoutSessions.retrieve(id, opts?)` | `GET v1/checkout-sessions/:id` |
| `fianto.checkoutSessions.cancel(id, opts?)` | `POST v1/checkout-sessions/:id/cancel` |
| `fianto.checkoutSessions.reissueLink(id, opts?)` | `POST v1/checkout-sessions/:id/link` |
| `fianto.orders.retrieve(id, opts?)` | `GET v1/orders/:id` |
| `fianto.orders.retrieveByOrderId(orderId, opts?)` | `GET v1/orders/lookup?order_id=` |
| `fianto.orders.list(params?, opts?)` | `GET v1/orders` |
| `fianto.payments.retrieve(id, opts?)` | `GET v1/payments/:id` |
| `fianto.payments.list(params?, opts?)` | `GET v1/payments` |
| `fianto.subscriptions.retrieve(id, opts?)` | `GET v1/subscriptions/:id` |
| `fianto.subscriptions.list(params?, opts?)` | `GET v1/subscriptions` |
| `fianto.subscriptions.cancel(id, { at: 'now' \| 'period_end' }, opts?)` | `POST v1/subscriptions/:id/cancel` |
| `fianto.products.retrieve(id, opts?)` | `GET v1/products/:id` |
| `fianto.products.list(params?, opts?)` | `GET v1/products` |
| `fianto.prices.retrieve(id, opts?)` | `GET v1/prices/:id` |
| `fianto.prices.list(params?, opts?)` | `GET v1/prices` |
| `fianto.events.retrieve(id, opts?)` | `GET v1/events/:id` |
| `fianto.events.list(params?, opts?)` | `GET v1/events` |
| `fianto.webhookEndpoint.sendTestEvent(opts?)` | `POST v1/webhook/test-event` |

Path ids are validated client-side against `^[A-Za-z0-9_]{1,64}$` before any request is sent —
an invalid id never reaches the network.

## Pagination

A `list()` call returns a `PagePromise`. `await` it for one page in the wire shape:

```ts
import { Fianto } from '@fianto/sdk';

const fianto = new Fianto();
const page = await fianto.orders.list({ status: 'PAID', limit: 50 });
page.items; // Order[]
page.next_cursor; // string | null — always an opaque string (every list() normalises its wire
// cursor to one), pass it straight back as `cursor` on the next call
```

Or `for await` it to walk every item, fetching pages lazily as you consume them:

```ts
import { Fianto } from '@fianto/sdk';

const fianto = new Fianto();
for await (const order of fianto.orders.list({ status: 'PAID' })) {
  console.log(order.id, order.total_amount);
}
```

Iteration stops on `next_cursor === null`, and also on an empty page — the API can emit a
cursor after a full last page, so the next fetch comes back empty rather than looping forever.
`limit` defaults to the API's default (20), max 100.

## Idempotency and retries

Every `POST` sends an `Idempotency-Key` — `crypto.randomUUID()` by default, generated **once
per logical call and reused on every retry** of that call (pass `opts.idempotencyKey` to supply
your own). This matters because a checkout session's `url` is returned exactly once, in the
create response: if the response is lost after the API created the session, a retry under the
same key gets the stored response back (`Idempotent-Replayed: true` header) with the same `url`,
rather than creating a second session or losing the link.

Automatically retried (each with jittered backoff, honouring `Retry-After` when the server
sends one): network errors, timeouts, `408`, `429`, every `5xx`, and `409` only when `code` is
`idempotency_request_in_progress` or `checkout_unavailable` (the latter always carries
`Retry-After`). Never retried: any other `4xx`, including `422 idempotency_key_reused`.

For crash recovery — say your process dies after the API created the session but before you
persisted its `url` — reuse a **stable** key derived from data you already have, e.g.:

```ts
import { Fianto, type CheckoutSessionCreateParams } from '@fianto/sdk';

declare const params: CheckoutSessionCreateParams;
declare const orderId: string;
declare const attempt: number;
const fianto = new Fianto();

await fianto.checkoutSessions.create(params, {
  idempotencyKey: `checkout:${orderId}:${attempt}`,
});
```

replaying the same call (same key, same body) within the key's 24-hour lifetime returns the
original session, `url` included, instead of creating a new one.

When the SDK gives up on a network failure, the `ConnectionError` / `TimeoutError` it throws
carries `requestId` and, for a `POST`, the `idempotencyKey` it used. The request may or may not
have reached the API; to recover, retry the same call with that key:

```ts
import { ConnectionError, Fianto, TimeoutError, type CheckoutSession, type CheckoutSessionCreateParams } from '@fianto/sdk';

declare const params: CheckoutSessionCreateParams;
const fianto = new Fianto();
let session: CheckoutSession;

try {
  session = await fianto.checkoutSessions.create(params);
} catch (err) {
  if ((err instanceof ConnectionError || err instanceof TimeoutError) && err.idempotencyKey) {
    session = await fianto.checkoutSessions.create(params, { idempotencyKey: err.idempotencyKey });
  } else throw err;
}
```

## Errors

```
FiantoError
├─ APIError { status, code, message, field?, details?, requestId, headers }
│  ├─ AuthenticationError     401
│  ├─ PermissionDeniedError   403
│  ├─ InvalidRequestError     400, 422
│  ├─ NotFoundError           404
│  ├─ ConflictError           409
│  ├─ RateLimitError          429 (retryAfterSeconds?)
│  ├─ ServiceUnavailableError 503
│  └─ InternalServerError     other 5xx
├─ ConnectionError   the request never got a response
└─ TimeoutError      the request didn't finish within timeoutMs
```

`code` is a stable machine-readable string (see `ErrorCode`); `message` is for humans. A
non-JSON error body still yields an `APIError` with `code: 'unknown'`.

```ts
import { APIError, ErrorCode, Fianto, isFiantoError, type CheckoutSessionCreateParams } from '@fianto/sdk';

declare const params: CheckoutSessionCreateParams;
const fianto = new Fianto();

try {
  await fianto.checkoutSessions.create(params);
} catch (err) {
  if (isFiantoError(err, ErrorCode.PaymentInProgress)) {
    // err is narrowed to APIError & { code: 'payment_in_progress' }
  }
  if (err instanceof APIError) {
    console.error(err.name, err.status, err.requestId); // requestId — quote it when contacting support
  }
  throw err;
}
```

Every `APIError` carries `requestId` (from the body's `request_id`, falling back to the
`X-Request-Id` response header) — include it when contacting support.

## Amounts

The API takes amounts as decimal strings (`"12.5"`) and returns them as base-unit integer
strings (`"12500000"`; USDC has 6 decimals). `usdc` works in strings and `bigint` only —
**never use floats for money.**

```ts
import { usdc } from '@fianto/sdk';

usdc.toBaseUnits('12.5'); // '12500000' — throws on more than 6 decimals, negatives, or junk
usdc.fromBaseUnits('12500000'); // '12.5'
usdc.format('12500000'); // '12.50 USDC'
usdc.format('12500000', { symbol: false }); // '12.50'
```

## Webhooks

```bash
# nothing extra to install — this is a subpath of @fianto/sdk
```

```ts
import { verifyWebhook } from '@fianto/sdk/webhooks';

export async function POST(request: Request) {
  const body = await request.arrayBuffer(); // the RAW body — never re-parse and re-stringify it
  const event = await verifyWebhook(body, request.headers, {
    secret: process.env.FIANTO_WEBHOOK_SECRET, // or pass string[] during a secret roll
  });
  // ...
}
```

`rawBody` accepts `string | Uint8Array | ArrayBuffer`; `headers` accepts a Fetch `Headers` or a
plain record. Verification hashes the exact bytes you pass — reading the body any other way
(e.g. through a body parser that re-encodes it) breaks the signature.

**Event types:** `checkout.session.completed`, `checkout.session.expired`,
`checkout.session.canceled`, `order.paid`, `order.expired`, `order.duplicate_payment`,
`subscription.created`, `subscription.renewed`, `subscription.past_due`,
`subscription.payment_failed`, `subscription.ended`, `subscription.cancel_scheduled`,
`subscription.cancel_withdrawn`, `test.event`, plus `endpoint.verification` (answered
automatically by `createWebhookHandler`, see below). `verifyWebhook`'s return type (`WebhookEvent`)
is a closed union of exactly these, so `switch (event.type)` narrows `event.data` with no cast —
but fianto may add event types after this SDK version ships, and a newer one still arrives at
runtime with the shape of `UnknownWebhookEvent` (a separate, exported type for exactly this case,
not a member of `WebhookEvent`). Give every `switch (event.type)` a `default:` branch that
ignores what it doesn't recognise (answer 2xx, never throw), or check
`isKnownEventType(event.type)` first:

```ts
import { createWebhookHandler } from '@fianto/sdk/handlers';
import { isKnownEventType } from '@fianto/sdk/webhooks';

export const POST = createWebhookHandler({
  onEvent: async (event) => {
    if (!isKnownEventType(event.type)) return; // a newer type this SDK version doesn't know
    switch (event.type) {
      case 'order.paid':
        console.log('paid', event.data.order_id);
        break;
      case 'subscription.ended':
        console.log('ended', event.data.id);
        break;
      default:
        break; // every other known type — ignored here, or handled the same way
    }
  },
});
```

**Delivery facts:** at-least-once, **no ordering guarantee** (a later event can arrive before an
earlier one), 10 s timeout per attempt, up to 8 attempts spread over ~28 hours. `event.id` (the
`webhook-id` header) is stable across every retry and redelivery of the same event — that's your
dedupe key.

**Auto-suspend:** if 5 deliveries in a row each exhaust every retry (your endpoint never answered
2xx to any of the up-to-8 attempts, for 5 separate events), fianto stops sending to that URL and
marks the endpoint back to "pending verification" — an outage on your side doesn't retry into
fianto forever. Deliveries already queued when that happens are held, not dropped or cancelled,
and go out once the endpoint is verified again. To reactivate: fix whatever was rejecting or
timing out deliveries, then in the dashboard (**Developers → Applications → your app → Webhook**)
click "Verify again" — that sends a fresh `endpoint.verification` probe, and a `200` answer to it
puts the endpoint back to active and releases the held deliveries.

### The generic handler

```ts
import { createWebhookHandler } from '@fianto/sdk/handlers';

export const POST = createWebhookHandler({
  secret: process.env.FIANTO_WEBHOOK_SECRET,
  onOrderPaid: async (event) => {
    // event.data is typed (WebhookEventMap['order.paid'], the same shape fianto.events.retrieve returns)
  },
  onEvent: async (event) => {
    // runs after the specific callback, for every verified business event
  },
});
```

It reads the body itself, bounded by `maxBodyBytes` (default `1_048_576`, 1 MiB — fianto's own
webhook payloads are well under this; a request whose declared `content-length` or actual bytes
read exceed it is answered `413 {"error":"payload_too_large"}` without reading the rest),
verifies it, answers `endpoint.verification` probes automatically (`200 {"challenge": …}` — no
code needed for dashboard URL verification), dispatches to your typed `on*` callback, and turns a
callback throw into `500 {"error":"handler_failed"}` so fianto retries delivery. A verification
failure answers `400 {"error":"invalid_webhook"}` without leaking the reason; pass
`onVerificationError` to log it server-side. Non-`POST` requests get `405`. The header checks
(method, signature headers, timestamp, secret) all run **before** the body is read at all — a
request with no chance of verifying is refused unread.

**Always wire `onVerificationError` and `onError`.** A missing or wrong secret fails exactly like
a forged request (`400`, no detail in the response), so without `onVerificationError` a
misconfigured deployment silently rejects every delivery. `onError(error, event)` receives
whatever your callback or `onEvent` threw (the response is still `500`, so fianto retries).
Neither reporter can change the response: if one throws, the throw is swallowed.

```ts
import { createWebhookHandler } from '@fianto/sdk/handlers';

declare const logger: { warn: (fields: unknown, msg: string) => void; error: (fields: unknown, msg: string) => void };

createWebhookHandler({
  secret: process.env.FIANTO_WEBHOOK_SECRET,
  onVerificationError: (err) => logger.warn({ reason: err.reason }, 'fianto webhook rejected'),
  onError: (err, event) => logger.error({ err, eventId: event.id }, 'fianto webhook handler failed'),
});
```

### Dedupe in the same transaction as the side effect

At-least-once delivery means your handler **will** see the same event more than once. Insert the
event id into a processed-events table inside the *same* database transaction that marks the
order paid — a unique-constraint violation on that insert means "already handled", and the
whole transaction (including your side effect) rolls back cleanly:

```ts
import { createWebhookHandler } from '@fianto/sdk/handlers';

// Your own query builder — a stand-in (e.g. Kysely) so the callback below type-checks; not
// part of @fianto/sdk.
declare const db: { transaction: (fn: (tx: any) => Promise<unknown>) => Promise<unknown> };
declare function isUniqueViolation(err: unknown): boolean;

export const POST = createWebhookHandler({
  onOrderPaid: async (event) => {
    await db.transaction(async (tx) => {
      try {
        await tx.insertInto('processed_webhook_events').values({ id: event.id }).execute();
      } catch (err) {
        if (isUniqueViolation(err)) return; // already processed this event.id — nothing to do
        throw err;
      }
      await tx.updateTable('orders').set({ status: 'paid' }).where('order_id', '=', event.data.order_id).execute();
    });
  },
});
```

Because there's no ordering guarantee, re-fetch current state
(`fianto.orders.retrieve(id)`) when the order matters rather than trusting the order events
arrived in. `fianto.events.retrieve(event.id)` is available as an independent, pull-based check
of what fianto actually sent, if you ever need to reconcile.

### Secret rolls

`verifyWebhook`'s `secret` accepts an array — during a roll, fianto signs each delivery with
both the old and new secret (`webhook-signature` carries two `v1,…` values), so pass both:

```ts
import { verifyWebhook } from '@fianto/sdk/webhooks';

declare const body: string;
declare const headers: Headers;

// process.env values are `string | undefined` — filter out whichever secret isn't set yet
// (e.g. before the new one is configured, or after the old one is retired).
const secrets = [process.env.FIANTO_WEBHOOK_SECRET_NEW, process.env.FIANTO_WEBHOOK_SECRET_OLD].filter(
  (secret): secret is string => secret !== undefined,
);
await verifyWebhook(body, headers, { secret: secrets });
```

### Testing

```ts
import { sampleEvent, signWebhook } from '@fianto/sdk/webhooks';

const { body, headers } = await signWebhook({ event: sampleEvent('order.paid'), secret: 'whsec_...' });
// POST body/headers at your own handler in a test
```

`sampleEvent(type, overrides?)` returns a realistic, schema-valid fixture for every event type
(`sampleVerificationEvent(challenge?)` for the `endpoint.verification` probe, which has no
`data` in the same map since it carries no `id`).

## Checkout route

```ts
import { createCheckoutHandler } from '@fianto/sdk/handlers';

// Your own cart lookup — a stand-in so this example type-checks; not part of @fianto/sdk.
declare function loadCartForSession(
  request: Request,
): Promise<{ orderId: string; totalUsdc: string; description: string }>;

export const POST = createCheckoutHandler({
  createSession: async (request) => {
    // Decide the price and order_id HERE, on your server. Never trust them from the request body.
    // `createSession` should also check the caller is a signed-in user and be rate-limited —
    // see "Authenticate and rate-limit `createSession`" below.
    const cart = await loadCartForSession(request);
    return {
      mode: 'payment',
      order_id: cart.orderId,
      amount: cart.totalUsdc,
      description: cart.description, // required alongside amount — omit both with price_id instead
      success_url: 'https://shop.example/thank-you',
      cancel_url: 'https://shop.example/cart',
    };
  },
});
```

The framework adapters (`@fianto/nextjs`, `@fianto/hono`, `@fianto/express`) pass `createSession`
a second `context` argument — the framework's own request context (Express: `{ req, res }`,
Hono: the `Context`, Next.js: the route context) — see each adapter's README.

- `POST` only (`405` otherwise).
- **CSRF guard:** rejects with `403` before calling the API unless one of two checks passes, in
  order: (1) the browser sent `Sec-Fetch-Site: same-origin` — checked first, and sufficient on
  its own regardless of `Origin`; (2) otherwise, `Origin` is present and is in `allowedOrigins`
  (default: the request URL's own origin). Behind a reverse proxy, the request URL's origin as
  Node/your framework sees it can be an internal host rather than the public one the browser
  called — `Sec-Fetch-Site` is unaffected by that (browsers send it, not the proxy), but for any
  client that doesn't send `Sec-Fetch-Site` (e.g. an older browser, or a deliberate cross-origin
  caller), set `allowedOrigins` explicitly to your public origin(s) rather than relying on the
  request-URL default. **This guard is CSRF protection, not abuse protection** — see below.
- Forces `ui_mode: 'popup'` regardless of what `createSession` returns.
- If the order already has an OPEN, unexpired session for exactly the same terms (`mode`,
  `amount`/`price_id`), the create call answers `url: null` and the handler reissues that
  session's link. If the terms differ, it answers `409 { error: { code:
  'order_session_mismatch', ... } }` and leaves the open session untouched — it never cancels and
  recreates one, because a transaction the payer already built for the old session can still
  settle after a cancel. Use a new `order_id` for changed terms (e.g. include a cart version), or
  cancel the open session yourself first.
- The browser receives `200 { id, url }` on success. On an API error it receives
  `{ error: { code, message } }` with the upstream status for an allowlisted set of codes the
  payer can act on — a session already in flight for this order answers `409 { error: { code:
  'payment_in_progress', ... } }`; the API's own rate limit answers `429 { error: { code:
  'rate_limited', ... } }` with a `retry-after` header passed through (the handler never waits
  out a rate limit itself — it answers `429` at once so the payer isn't left staring at a spinner
  for a long, unpredictable wait). **Every other failure — including a `401`/`403` from fianto
  itself (a credentials problem) and every `5xx` — answers a generic `500 { error: { code:
  'internal_error', ... } }`**, never the upstream status or body. Neither response ever echoes
  your credentials or the full upstream error body.

`onError(error)` is called for every error, including the ones relayed to the browser and the
ones collapsed into the generic `500` (the response is unchanged either way) — wire it up, or a
misconfigured deployment (e.g. bad credentials) fails with no visible reason on your side.

Return a `Response` from `createSession` instead of session params to refuse the request
yourself (a login check, a closed cart, etc.) — it's returned as-is.

### Authenticate and rate-limit `createSession`

The CSRF guard above stops a cross-site page from calling your checkout route with the payer's
cookies — it does **not** stop a signed-in payer's own browser, or a script with valid
same-origin access, from calling it in a fast loop. `createSession` is an API endpoint like any
other on your server: check the caller is who they claim to be (a session, a signed cart token —
whatever your app already uses) and rate-limit it the same way you would any other POST route
that starts a real side effect, on top of relying on fianto's own `429 rate_limited`.

## Security

- `appSecret` is server-side only. `new Fianto()` throws if constructed where `window` exists
  unless you pass `dangerouslyAllowBrowser: true` — which ships your secret to every visitor and
  should not be used outside of a deliberate, trusted embedding.
- Verify webhooks against the **raw** request body. A framework or proxy that parses, then
  re-serialises, the body before your handler sees it will break signature verification (see
  Troubleshooting).
- `toleranceSeconds` (default 300) must be between 1 and 3600 — replay protection on webhook
  delivery can be neither switched off nor made meaningless by setting it absurdly high.
- A webhook `secret` must be `whsec_` + base64 of at least 16 raw bytes; anything shorter is
  refused at handler construction (`WebhookVerificationError('invalid_secret')`).

## Money safety

A browser redirect back to your `success_url`, or a popup reporting success, is **not proof of
payment** — it only means the customer's browser believes the checkout finished. Fulfil an order
only on a verified `order.paid` (or `checkout.session.completed`) webhook, or an explicit
server-side `fianto.orders.retrieve(id)` / `fianto.checkoutSessions.retrieve(id)` call that shows
a paid status. Never tell a customer "nothing was charged" based on the browser's view alone —
you cannot see from there whether a transaction is still confirming on-chain.

## Troubleshooting

- **`Missing appId: pass it to new Fianto({ appId }) or set FIANTO_APP_ID.`** (or `appSecret`) —
  the named env var isn't set and no option was passed.
- **`401` / `code: 'invalid_api_credentials'`** — wrong `appId`/`appSecret` pair, or credentials
  for the wrong deployment (see the next point).
- **Webhook signature verification fails intermittently or always** — almost always a re-encoded
  body: a body parser (`express.json()`, a proxy that decompresses/re-serialises, a framework
  that string-decodes non-UTF-8 bytes) ran before your handler and handed you bytes that differ
  from what fianto signed. Read the raw body yourself, before any parser touches it (see the
  Express adapter's README for the concrete fix).
- **Requests succeed against the wrong environment** — `baseUrl` defaults to the production API
  (`https://api.fianto.xyz`), so a self-hosted or local backend needs an explicit
  `FIANTO_BASE_URL` (or the `baseUrl` option), e.g. `http://localhost:3000` while running the
  backend yourself. Double check it (and `FIANTO_APP_ID`/`FIANTO_APP_SECRET`) match the
  deployment you intend.

- **`instanceof FiantoError` is false for an error you know came from the SDK** — the package
  ships both ESM and CommonJS builds. If one app loads `@fianto/sdk` through both `require` and
  `import` (directly or via a dependency), it gets two copies with two sets of classes. Use one
  module format throughout (or compare `err.name` as a last resort).

## License

MIT
