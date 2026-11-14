# @fianto/sdk

The server-side SDK for [fianto](https://fianto.xyz): a typed API client, Standard Webhooks
verification, and framework-agnostic route handlers for Solana USDC payments, and card payments
through the merchant's own Stripe account (hosted checkout, one-time payments, subscriptions; see
[Card payments](#card-payments)).

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
    order_id: 'order_1001', // your own id — stable per order: reuse it for the same cart/order,
    // change it only when the terms change (e.g. include a cart version)
    amount: '10.00', // decimal USD price (USDC 1:1 for crypto, USD for card)
    description: 'Order order_1001', // required alongside amount — omit only with price_id
    success_url: 'https://shop.example/thank-you',
    cancel_url: 'https://shop.example/cart',
  });

  // session.url is the hosted payment link. Redirect the browser to it, or hand it to a popup.
  // It is null when order_1001 already has an OPEN session: create returned that session
  // unchanged, so ask for a new link to it (or use a new order_id for different terms).
  const url = session.url ?? (await fianto.checkoutSessions.reissueLink(session.id)).url;
  return url ? Response.redirect(url, 303) : undefined;
}
```

Never fulfil an order from this response alone — see [Money safety](#money-safety).

## Configuration

```ts no-check
new Fianto({
  appId, // default: process.env.FIANTO_APP_ID
  appSecret, // default: process.env.FIANTO_APP_SECRET — server-side only
  baseUrl, // default: process.env.FIANTO_BASE_URL, else the API of `network`
  network, // 'mainnet' | 'devnet'; default: process.env.FIANTO_NETWORK, else the appSecret's network
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
| `baseUrl` | `FIANTO_BASE_URL` | the API of `network` | Override it to point at your own self-hosted deployment or a backend running locally, e.g. `http://localhost:3000`. It wins over `network`. Must be `https://`; `http://` is only accepted for `localhost`, `127.0.0.1` and `[::1]`. |
| `network` | `FIANTO_NETWORK` | the `appSecret`'s network | `'mainnet'` is production (`https://api.fianto.xyz`, real USDC) and takes only a live secret key (`fian_sk_live_`). `'devnet'` is the sandbox (`https://devnet-api.fianto.xyz`, exported as `DEVNET_BASE_URL`, test USDC) and takes only a test secret key (`fian_sk_test_`). Unset, a `fian_sk_test_` key picks `'devnet'` and any other key `'mainnet'`. A network that contradicts the key's prefix, or anything other than these two values, throws a `FiantoError`. |
| `timeoutMs` | — | `30_000` | Per attempt, not per call. |
| `maxRetries` | — | `2` | Retries after the first attempt, 0–10. |
| `fetch` | — | the global `fetch` | Override for custom networking or testing. |
| `dangerouslyAllowBrowser` | — | `false` | Constructing `Fianto` in a browser page (`window`/`document` exist) or a browser Web Worker (`importScripts` exists) throws unless this is `true`. There is no publishable/browser-safe key: the merchant's server always creates checkout sessions (see [Checkout route](#checkout-route)). |

A missing `appId` or `appSecret` throws a `FiantoError` at construction, naming the option and
the env var to set. `baseUrl` and `network` need neither: they fall back to the API of the key's
network, the production API for a live key.

Each application has two secret keys: a live key (`fian_sk_live_…`) for mainnet and a test key
(`fian_sk_test_…`) for devnet. Neither works on the other network: the API answers 401
`api_key_wrong_network`. The client reads the network from the key's prefix, so a live key throws
a `FiantoError` at construction with `network: 'devnet'` (or `FIANTO_NETWORK=devnet`), and a test
key does with `network: 'mainnet'`. A key whose `baseUrl` (or `FIANTO_BASE_URL`) is the other
network's API throws too, however the network was set: a test key with `https://api.fianto.xyz`, a
live key with `https://devnet-api.fianto.xyz`. Any other base URL is not checked.

To try things out on the sandbox, use the test key: the devnet network follows from it. Responses and webhook events carry a
`network` field (`"mainnet"` or `"devnet"`), and `verifyWebhook` takes an optional `network` to
refuse an event from the other one:

```ts no-check
const fianto = new Fianto(); // FIANTO_APP_SECRET=fian_sk_test_…, so devnet (FIANTO_NETWORK=devnet says the same)
const event = await verifyWebhook(rawBody, headers, { network: 'devnet' }); // throws 'network_mismatch' otherwise
```

`createWebhookHandler({ network })` does the same check, answering 400 and calling
`onVerificationError`; `createCheckoutHandler({ network })` sets the network of the client it creates.
If you switch exhaustively over `WebhookVerificationFailure`, add `network_mismatch`.

A devnet call may answer 503 `service_busy` with `Retry-After` when the sandbox cannot reach its
identity source; retry it.

Get `appId`/`appSecret` from **Dashboard → Developers → Applications**: your app, then "Reveal"
the secret (the live key for mainnet, the test key for devnet).

## Resources

`options` on every method: `{ idempotencyKey?: string; timeoutMs?: number; signal?: AbortSignal; maxRetries?: number }`
(`idempotencyKey` only does anything on a write). Where a method takes an `id`, `params` sits
between it and `options` — even on `retrieve`, `cancel` and `reissueLink`, which don't take any
params yet (`params` is `{}` for these today, but still occupies that position): pass `{}`
explicitly, or an object literal, to reach `options` as the third argument. `create`, `list` and
`application.retrieve`/`webhookEndpoint.sendTestEvent` have no `id` at all, so `params` is their
first argument; `orders.retrieveByOrderId` is the one method with neither an `id` slot nor a
`params` slot — `options` is its second and only other argument.

| Method | Route |
|---|---|
| `fianto.application.retrieve(params?, options?)` | `GET v1/application` |
| `fianto.checkoutSessions.create(params, options?)` | `POST v1/checkout-sessions` |
| `fianto.checkoutSessions.retrieve(id, params?, options?)` | `GET v1/checkout-sessions/:id` |
| `fianto.checkoutSessions.cancel(id, params?, options?)` | `POST v1/checkout-sessions/:id/cancel` |
| `fianto.checkoutSessions.reissueLink(id, params?, options?)` | `POST v1/checkout-sessions/:id/link` |
| `fianto.orders.retrieve(id, params?, options?)` | `GET v1/orders/:id` |
| `fianto.orders.retrieveByOrderId(orderId, options?)` | `GET v1/orders/lookup?order_id=` |
| `fianto.orders.list(params?, options?)` | `GET v1/orders` |
| `fianto.payments.retrieve(id, params?, options?)` | `GET v1/payments/:id` |
| `fianto.payments.list(params?, options?)` | `GET v1/payments` |
| `fianto.subscriptions.retrieve(id, params?, options?)` | `GET v1/subscriptions/:id` |
| `fianto.subscriptions.list(params?, options?)` | `GET v1/subscriptions` |
| `fianto.subscriptions.cancel(id, { at: 'now' \| 'period_end' }, options?)` | `POST v1/subscriptions/:id/cancel` |
| `fianto.products.retrieve(id, params?, options?)` | `GET v1/products/:id` |
| `fianto.products.list(params?, options?)` | `GET v1/products` |
| `fianto.prices.retrieve(id, params?, options?)` | `GET v1/prices/:id` |
| `fianto.prices.list(params?, options?)` | `GET v1/prices` |
| `fianto.events.retrieve(id, params?, options?)` | `GET v1/events/:id` |
| `fianto.events.list(params?, options?)` | `GET v1/events` |
| `fianto.webhookEndpoint.sendTestEvent(params?, options?)` | `POST v1/webhook/test-event` |

Path ids are validated client-side against `^[A-Za-z0-9_]{1,64}$` before any request is sent —
an invalid id never reaches the network.

**Ending a price.** A merchant ends a product or price in the dashboard; afterwards `status` is
`ENDED` and a new checkout for it is refused with `422 price_ended` (or `product_ended`).
Ending a recurring price also cancels its subscribers (a price archived before End replaced
Archive on 2026-10-05 is not affected):

- each live subscriber with no cancel yet gets a merchant cancel at the end of their current
  period: `subscription.cancel_scheduled` with `cancel_reason: MERCHANT_CANCELED`;
- a subscriber who already cancelled keeps their own cancel, and no new event is sent; the
  merchant cancel is still recorded, so if that payer resumes, it takes over and a second
  `subscription.cancel_scheduled` (`cancel_reason: MERCHANT_CANCELED`) is sent;
- no new renewal charge is started after the End, even before that event arrives (one already
  sent before it can still land);
- an open subscription checkout for that price can no longer be paid (the checkout page refuses
  it with `subscription_plan_failed`).

`fianto.events.retrieve`/`.list` resolve to `FiantoEvent` — the same typed union `@fianto/sdk/webhooks`
delivers, plus the wire's own `object: 'event'` discriminator. It's named `FiantoEvent`, not
`Event`: the generated schema's own name would otherwise shadow the DOM global and break
`instanceof Event` and similar checks for anyone importing it.

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
per logical call and reused on every retry** of that call (pass `options.idempotencyKey` to supply
your own). This matters because a checkout session's `url` is returned only by `create` (for a
new session) and by `reissueLink`; every other read, and a `create` that returns the order's
already-open session, has `url: null`. If the create response is lost after the API created the
session, a retry under the same key gets the stored response back (`Idempotent-Replayed: true`
header) with the same `url`, rather than creating a second session or losing the link.

Automatically retried (each with jittered backoff, honouring `Retry-After` when the server
sends one): network errors, timeouts, `408`, `429 rate_limited`, every `5xx` except
`503 subscriptions_paused`, and `409` only when `code` is `idempotency_request_in_progress` or
`checkout_unavailable` (the latter always carries `Retry-After`). Never retried: any other `4xx`,
including `422 idempotency_key_reused` and `429 plan_limit_reached` (a per-day cap on new
subscription plans, sent without `Retry-After`), and `503 subscriptions_paused`.

The `503`s you may see (the busy ones once retries run out):

- `503 checkout_busy` (checkout-session routes) / `503 service_busy` (every other route): fianto's
  database, or the Solana RPC it reads, was too busy to answer, and nothing was started. It sends
  `Retry-After: 3`; try again after it. The API's message is "Payments are very busy right now.
  Nothing was charged. Try again in a few seconds." for `checkout_busy` and "Fianto is very busy
  right now. Try again in a few seconds." for `service_busy`.
- `503 subscription_busy` (`subscriptions.cancel`): another request was updating the
  subscription. Nothing was changed; try again.
- `503 subscriptions_paused` (`checkoutSessions.create` with `mode: 'subscription'`): new
  subscriptions are paused for now; existing ones are unaffected. Not retried (it only changes
  when fianto restarts); try again later.

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
├─ APIError { status, code, message, field?, details?, method?, requestId, headers }
│  ├─ AuthenticationError     401
│  ├─ PermissionDeniedError   403
│  ├─ InvalidRequestError     400, 422 (incl. 422 payment_method_unavailable, with method)
│  ├─ NotFoundError           404
│  ├─ ConflictError           409
│  ├─ RateLimitError          429 (retryAfterSeconds?)
│  ├─ ServiceUnavailableError 503
│  └─ InternalServerError     other 5xx
├─ ConnectionError   the request never got a response (incl. a redirect: see below)
├─ TimeoutError      the request didn't finish within timeoutMs — code: 'timeout'
├─ AbortError        options.signal was aborted — code: 'aborted'
├─ AmountError       thrown by `usd.*` / `money.format` (see Amounts below), and by `refundDelta`
│  │                 for a bad applied_amount — code: 'invalid_amount'
│  └─ UsdcError      thrown by `usdc.*` — code: 'invalid_usdc_amount'
├─ RefundStatusError thrown by `refundDelta` for a refund status this SDK version does not know
│                    (upgrade @fianto/sdk) — code: 'unknown_refund_status', refundStatus
└─ WebhookVerificationError  thrown by `verifyWebhook` — reason (see Webhooks below)
```

`code` is a stable machine-readable string (see `ErrorCode`); `message` is for humans. A
non-JSON error body still yields an `APIError` with `code: 'unknown'`. A redirect response is
never followed (`redirect: 'manual'` under the hood) — it's treated as a `ConnectionError` like
any other response that never produced usable data, not silently sent somewhere else. A
retryable response whose `Retry-After` exceeds 10 s is not waited out: the `RateLimitError` (or
other retryable error) is thrown at once, with `retryAfterSeconds` set, rather than holding the
call for an unpredictable amount of time.

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

`isFiantoError(err)` (any `FiantoError`) and `isFiantoError(err, code)` (narrowed to that code)
are brand-based (`Symbol.for`, not a class check), so they — and, specifically,
`err instanceof FiantoError` itself — correctly recognise an error even from a different copy of
this package (ESM+CJS in the same app, or two versions in a monorepo), unlike
`instanceof <a specific subclass>` (`APIError`, `RateLimitError`, …), which still uses the
ordinary prototype-chain check and can miss across copies. Prefer `isFiantoError`/`isAPIError`
over `instanceof` for anything that decides behaviour.

Every `APIError` carries `requestId` (from the body's `request_id`, falling back to the
`X-Request-Id` response header) — include it when contacting support.

`checkoutSessions.create` takes an optional `payment_methods` (`'crypto'`, `'card'`, or both;
absent = every method the merchant has enabled). `['card']` that no card gateway can offer
throws `422 payment_method_unavailable` with `err.method === 'card'`; an empty list
(`payment_methods: []`) type-checks but the API answers `400 validation_failed`. See
[Card payments](#card-payments) for when a card can be offered.

## Amounts

The API takes amounts as decimal strings (`"12.5"`) and returns them as base-unit integer
strings (`"12500000"`): 6 decimals, for USDC (crypto) and US dollars (card) alike. A payload's
`currency` says which: `"USDC"` or `"USD"`. `usdc`, `usd` and `money` work in strings and
`bigint` only — **never use floats for money.**

```ts
import { money, usd, usdc } from '@fianto/sdk';

usdc.toBaseUnits('12.5'); // '12500000' — throws on more than 6 decimals, negatives, or junk
usdc.fromBaseUnits('12500000'); // '12.5'
usdc.format('12500000'); // '12.50 USDC'
usdc.format('12500000', { symbol: false }); // '12.50'

usd.toBaseUnits('25.00'); // '25000000' — at most 2 decimals: a dollar price is whole cents
usd.format('25000000'); // '$25.00'

money.format('25000000', 'USD'); // '$25.00'
money.format('25000000', 'USDC'); // '25.00 USDC'
```

To show an amount, `money.format(base, currency)` takes a `Currency`: `'USDC' | 'USD'`, or any
string, such as one read back from your own database. Pass it the payload's own `currency` field.
It throws an `AmountError` for a currency it does not know, and also takes `{ symbol: false }`.

**What a total is made of.** Checkout sessions, orders, payments and subscriptions carry `amount` (the
price, what reaches the merchant), `fee_amount` (Fianto's fee), `network_fee_amount` and
`total_amount`, which is always `amount + fee_amount + network_fee_amount`:

- **A card payment carries no Fianto fee:** a card payment, an order or session charged by card
  and a card subscription read `fee_amount` and `network_fee_amount` `"0"`, and `total_amount`
  equals `amount`. Stripe's own fees are charged in the merchant's Stripe account. The rest of
  this list is about crypto.
- `network_fee_amount` is a flat fee that the **payer** pays on every subscription charge, the
  first one included, and on every one-time payment. It goes to Fianto with the fee. Its amount is
  a Fianto setting (currently 0.01 USDC, `'10000'`).
- On a subscription it is fixed per plan when the plan is created and never changes for that plan;
  a subscription from a plan created before the fee existed carries `'0'`.
- On a one-time crypto payment it is fixed on the order and its `mode: 'payment'` session when
  the checkout is created, and the payment copies its session's. It is `'0'` when the one-time fee
  was off, as on every checkout opened before 29 October 2026, when one-time payments started
  carrying it. A card payment always reads `'0'`.
- On a subscription, `total_amount` is what every charge takes (the cap the payer signed). In a
  webhook's `period`, `network_fee_due` is that period's share, next to `amount_due` and
  `fee_due`.
- `v1` reads always include `network_fee_amount`. In webhook payloads (`checkout.session.*`,
  `order.*`, `subscription.*`) it is optional, as is `period.network_fee_due`: events created before
  the fee existed (October 2026; for `order.*`, before one-time payments carried it) do not have them, and redeliveries and `fianto.events` return them
  as they were stored. Treat a missing value as `'0'`:

```ts
import { money } from '@fianto/sdk';
import type { WebhookEventOf } from '@fianto/sdk/webhooks';

declare const event: WebhookEventOf<'subscription.renewed'>;
const networkFee = event.data.network_fee_amount ?? '0';
console.log(money.format(event.data.total_amount, event.data.currency), money.format(networkFee, event.data.currency));
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
`payment.refunded`, `payment.disputed`,
`subscription.created`, `subscription.renewed`, `subscription.past_due`,
`subscription.payment_failed`, `subscription.ended`, `subscription.cancel_scheduled`,
`subscription.cancel_withdrawn`, `invoice.issued`, `invoice.paid`, `invoice.voided`,
`invoice.payment_recorded`, `credit_note.issued`, `test.event`, plus `endpoint.verification` (answered
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
puts the endpoint back to active and releases the held deliveries. At most 10,000 deliveries are
held per endpoint: events past that cap are not delivered, even after the endpoint is verified
again (the dashboard shows that the cap was reached). After a long outage, reconcile with
`fianto.events.list()`.

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

One callback per event type, each typed with that event:

| Callback | Event |
|---|---|
| `onCheckoutSessionCompleted` / `onCheckoutSessionExpired` / `onCheckoutSessionCanceled` | `checkout.session.completed` / `.expired` / `.canceled` |
| `onOrderPaid` / `onOrderExpired` / `onOrderDuplicatePayment` | `order.paid` / `order.expired` / `order.duplicate_payment` |
| `onPaymentRefunded` / `onPaymentDisputed` | `payment.refunded` / `payment.disputed` (see [Card payments](#card-payments)) |
| `onSubscriptionCreated` / `onSubscriptionRenewed` / `onSubscriptionPastDue` / `onSubscriptionPaymentFailed` | `subscription.created` / `.renewed` / `.past_due` / `.payment_failed` |
| `onSubscriptionEnded` / `onSubscriptionCancelScheduled` / `onSubscriptionCancelWithdrawn` | `subscription.ended` / `.cancel_scheduled` / `.cancel_withdrawn` |
| `onInvoiceIssued` / `onInvoicePaid` / `onInvoiceVoided` / `onInvoicePaymentRecorded` | `invoice.issued` / `.paid` / `.voided` / `.payment_recorded` |
| `onCreditNoteIssued` | `credit_note.issued` |
| `onTestEvent` | `test.event` |

A type this SDK version does not know reaches `onEvent` only.

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

`sampleEvent(type, overrides?)` returns a realistic, schema-valid fixture for every event type,
with every field today's backend sends (`sampleVerificationEvent(challenge?)` for the
`endpoint.verification` probe, which has no `data` in the same map since it carries no `id`).
`overrides` takes `id`, `timestamp`, `network`, `data` (merged over the sample's) and `method`:

```ts
import { sampleEvent } from '@fianto/sdk/webhooks';

const card = sampleEvent('order.paid', { method: 'card' });
// card.data: currency 'USD', fees '0', payment { gateway: 'stripe', method: 'card', signature: null }
const crypto = sampleEvent('order.paid'); // the default: crypto
const dispute = sampleEvent('payment.disputed'); // card: only a card payment can be disputed
```

`method: 'card'` builds the card form of a session, order, payment or subscription event: US
dollars, no Fianto fee (fees `'0'`), no signature, no wallet, a Visa ending 4242. A type with no such form refuses it
(a type error, and a `FiantoError` at runtime): `order.expired` (an expired order was never paid),
`payment.disputed` by crypto, the invoice events and `test.event`.

## Checkout route

```ts
import { createCheckoutHandler } from '@fianto/sdk/handlers';

// Your own cart lookup — a stand-in so this example type-checks; not part of @fianto/sdk.
declare function loadCartForSession(
  request: Request,
): Promise<{ orderId: string; total: string; description: string }>;

export const POST = createCheckoutHandler({
  createSession: async (request) => {
    // Decide the price and order_id HERE, on your server. Never trust them from the request body.
    // `createSession` should also check the caller is a signed-in user and be rate-limited —
    // see "Authenticate and rate-limit `createSession`" below.
    const cart = await loadCartForSession(request);
    return {
      mode: 'payment',
      order_id: cart.orderId,
      amount: cart.total, // decimal USD price, e.g. "10.00" (USDC 1:1 for crypto, USD for card)
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
- **`success_url`/`cancel_url` must be `https://`.** The production API refuses `http://` for
  either one — including `http://localhost:...` — with `400 { error: { code: 'url_insecure',
  ... } }`; it's not just a local-vs-production stand-in like `baseUrl`'s `localhost` exception.
  For local development, use an `https` `SITE_URL` (e.g. a tunnel such as ngrok or Cloudflare
  Tunnel) or point `baseUrl`/`FIANTO_BASE_URL` at a local backend that has
  `CHECKOUT_ALLOW_INSECURE_URLS` set.
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
  `amount`/`price_id`, and whether `payment_methods` is card-only), the create call answers `url: null` and the handler reissues that
  session's link. If the terms differ, it answers `409 { error: { code:
  'order_session_mismatch', ... } }` and leaves the open session untouched — it never cancels and
  recreates one, because a transaction the payer already built for the old session can still
  settle after a cancel. Use a new `order_id` for changed terms (e.g. include a cart version), or
  cancel the open session yourself first. The open session does not echo `payment_methods`:
  only a switch to or from `['card']` is caught; `['crypto']` versus `['crypto', 'card']` is
  not, so use a new `order_id` for that change too. An open session for a `price_id` that has since
  ended is not reopened either: the handler answers `422 { error: { code: 'price_ended', ... } }`
  (the `OpenSessionPriceEndedError` passed to `onError`, code `open_session_price_ended`, names the
  session and the price).
- **`mode: 'subscription'`: an `order_id` can be used by one completed checkout only.** A new
  subscribe (after a cancel, or a second click once the first one completed) needs a new
  `order_id`, for example one with an attempt number or a timestamp in it; otherwise fianto
  answers `409 { error: { code: 'order_id_in_use', ... } }`. A stable `order_id` is right for a
  `mode: 'payment'` order, where a paid order answers `order_already_paid`.
- The browser receives `200 { id, url }` on success. On an API error it receives
  `{ error: { code, message } }` with the upstream status for an allowlisted set of codes the
  payer can act on — a session that may already have a payment in flight answers `409 { error:
  { code: 'payment_in_progress', ... } }`; a used subscription `order_id` answers `409 order_id_in_use`;
  the API's own rate limit answers `429 { error: { code: 'rate_limited', ... } }` with a
  `retry-after` header passed through (a `429 plan_limit_reached` is a per-day cap, relayed but
  never retried); a busy or paused fianto answers `503` with `checkout_busy`, `service_busy` or
  `subscriptions_paused`, `retry-after` passed through when sent. A `429 rate_limited` isn't necessarily
  the first thing the payer sees, though: the underlying client (`new Fianto()`) already retries
  a 429 whose `Retry-After` is 10 s or less, up to `maxRetries` attempts (default 2) — the
  checkout route only answers `429` at once when `Retry-After` exceeds 10 s, or once those
  retries are exhausted, not on every rate-limited attempt (see [Idempotency and
  retries](#idempotency-and-retries)). Pass `fianto: new Fianto({ maxRetries: 0 })` to
  `createCheckoutHandler` if you'd rather it answer `429` immediately every time. The same holds
  for the busy `503`s: the client retries them first (`subscriptions_paused` is answered at once). **Every other failure — including a
  `401`/`403` from fianto itself (a credentials problem) and every other `5xx` — answers a generic
  `500 { error: { code: 'internal_error', ... } }`**, never the upstream status or body. Neither response ever echoes your credentials or the full upstream error body.

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

## Card payments

A payer can pay by card as well as in crypto, when the merchant has connected their own Stripe
account and turned card payments on in the dashboard. The card money goes to the merchant's
Stripe account. The merchant pays nothing to Fianto on a card payment: its `fee_amount` and
`network_fee_amount` read `"0"` and `total_amount` equals `amount`. Stripe charges its own fees in
the merchant's Stripe account.

### One create call for both rails

`payment_methods` is optional. Leave it out to offer every method the merchant has enabled; pass
`['card']` for card only, or `['crypto']` for crypto only.

```ts
import { Fianto, isFiantoError } from '@fianto/sdk';

const fianto = new Fianto();

const terms = {
  mode: 'payment',
  amount: '10.00', // decimal USD price (USDC 1:1 for crypto, USD for card)
  description: 'Order order_1001',
  success_url: 'https://shop.example/thank-you',
  cancel_url: 'https://shop.example/cart',
} as const;

try {
  // omit payment_methods to offer every method the merchant has enabled
  await fianto.checkoutSessions.create({ ...terms, order_id: 'order_1001', payment_methods: ['card'] });
} catch (err) {
  if (isFiantoError(err, 'payment_method_unavailable')) {
    // No card can be offered for this checkout (err.method === 'card'): offer crypto instead.
    // The refused create made nothing, so the same order_id is a fresh create.
    await fianto.checkoutSessions.create({ ...terms, order_id: 'order_1001', payment_methods: ['crypto'] });
  } else {
    throw err;
  }
}
```

- **When a card can be offered.** The amount is whole cents, from $0.50 to $999,999.99 (fianto's
  own card limit), and the merchant's Stripe connection is active with card payments on. A
  subscription session also needs card subscriptions, which the merchant switches on in the
  dashboard separately from card payments; until they do, a subscription is paid in crypto.
- **Otherwise,** `['card']` throws at create: `isFiantoError(err, 'payment_method_unavailable')`,
  with `err.method === 'card'`. A refused create makes nothing (no order, no session), so retry
  the same `order_id` with `['crypto']`, as the snippet does. `['crypto', 'card']` (or no
  `payment_methods`) is never refused for card: the checkout page then offers crypto only.
- **Stripe's own minimum can be higher.** "The minimum amount you can charge depends on the payout
  bank account settlement currency", so a $0.50 card charge can be refused for a merchant who
  settles in another currency; fianto checks only the 50 cents
  (https://docs.stripe.com/currencies.md#minimum-and-maximum-charge-amounts).
- **A card session reads `currency: "USD"`** when it is card-only or a card paid it, with fees
  `"0"`. Otherwise it reads `"USDC"`. Show amounts with `money.format(amount, currency)`.
- **Changing the methods of an existing order needs a new `order_id`.** The checkout handler catches a
  switch to or from `['card']` (`409 order_session_mismatch`, `fields: ['payment_methods']`), but an
  open session does not echo its `payment_methods`, so `['crypto']` and `['crypto', 'card']` cannot
  be told apart: use a new `order_id` (see [Checkout route](#checkout-route)).

### One webhook handler for both rails

`order.paid` fires for both. Its `payment` says how it was paid: `gateway` `'solana'` or
`'stripe'`, `method` `'crypto'` or `'card'`. A card payment has no chain transaction, so its
`signature` is null.

```ts
import { money } from '@fianto/sdk';
import { createWebhookHandler } from '@fianto/sdk/handlers';

// Your own fulfilment — a stand-in so this example type-checks; not part of @fianto/sdk.
declare function fulfil(orderId: string, note: string): Promise<void>;

export const POST = createWebhookHandler({
  onOrderPaid: async (event) => {
    const { order_id, total_amount, currency } = event.data;
    if (event.data.payment.method === 'card') {
      await fulfil(order_id, `${money.format(total_amount, currency)} by card`);
    } else {
      // Crypto. An event stored before card payments has no `method` key at all, so this
      // `else` is the crypto branch: never compare `method` with 'crypto' instead.
      await fulfil(order_id, `${money.format(total_amount, currency)}, Solana ${event.data.payment.signature}`);
    }
  },
});
```

Branch as `method === 'card'`, then `else`, everywhere (orders, sessions, subscriptions,
`fianto.events`): events created before card payments have no `method` key, and they are crypto.
The types follow this: after `method === 'card'` the `signature` is `null`, and in the `else` of a
paid payment it is a `string`.

On the v1 API, `Payment`, `Order['payment']`, `CheckoutSession['payment']` and `Subscription` are
unions on `method` too:

```ts
import { Fianto } from '@fianto/sdk';

declare const paymentId: string;
const fianto = new Fianto();

const payment = await fianto.payments.retrieve(paymentId);
if (payment.method === 'card') {
  console.log(payment.card?.brand, payment.card?.last4); // either half can be null
} else {
  console.log(payment.signature); // the Solana signature
}
```

A card payment's `customer.wallet` is always null, and every key of its `customer` is null when
checkout collected no email. A card charge on an already-paid order is refunded in full
automatically: `order.duplicate_payment` then carries `duplicate: { signature: null, amount,
gateway: 'stripe' }`.

### Refunds

`payment.refunded` fires for both rails, whenever a payment's `refunded_amount` moves, and only
then. Its `refund.status` says which way it moved, by `refund.applied_amount` (always more than
0):

- `succeeded` (a refund) and `dispute_lost` (a card dispute was lost, or a lost dispute's amount
  went up) move it up;
- `failed` (a refund that had succeeded failed later) and `reversed` (a lost dispute was won late,
  or a lost dispute's amount went down) move it down.

A refund never changes a payment's `status`: a refunded payment stays `SUCCEEDED`, with
`refund_status` `partial` or `full`.

To keep a running total, add `refundDelta(event.data)` once per event id, in the same transaction
as your own write (the same dedupe as [any other event](#dedupe-in-the-same-transaction-as-the-side-effect)):

```ts
import { createWebhookHandler } from '@fianto/sdk/handlers';
import { refundDelta } from '@fianto/sdk/webhooks';

// Your own storage — a stand-in so this example type-checks; not part of @fianto/sdk.
declare const db: {
  transaction: (fn: (tx: {
    firstTime: (eventId: string) => Promise<boolean>;
    addRefunded: (paymentId: string, delta: bigint) => Promise<void>;
  }) => Promise<void>) => Promise<void>;
};

export const POST = createWebhookHandler({
  onPaymentRefunded: async (event) => {
    await db.transaction(async (tx) => {
      if (!(await tx.firstTime(event.id))) return; // once per event id
      await tx.addRefunded(event.data.payment.id, refundDelta(event.data)); // + or −
    });
  },
});
```

- **The current figure is `GET /v1/payments/{id}`** (`fianto.payments.retrieve(id)`,
  `refunded_amount`). Seed a running total once from it, then add each event's signed
  `applied_amount` (`refundDelta`), once per event id. Crypto refunds recorded before
  `payment.refunded` existed moved that figure with no event, which is why you seed. A seed is
  exact only when none of that payment's events was in flight while you read it, so compare your
  total with `GET /v1/payments/{id}` to be sure. If your total differs from `refunded_amount`
  while none of that payment's events is in flight, re-seed it from `GET /v1/payments/{id}`.
  Events can arrive late, twice or out of order,
  so the last one delivered is not always the newest; the sum does not depend on the order.
  Never line events up by their `timestamp`: it is when fianto wrote the event, before the
  change committed, so it cannot line one up against your seed.
- **Never pair or dedupe events by `refund.id`.** One card refund can be two `succeeded` events
  with the same `refund.id`; count both.
- **Never undo the `dispute_lost` when its `reversed` arrives.** A refund that succeeds or fails
  while a lost dispute already covers that money publishes nothing, and the dispute's later
  `reversed` carries it, so a `reversed` need not equal the `dispute_lost`. Lost 25, then a 10
  refund absorbed, then `reversed` 15: the figure ends at 10, which the sum of deltas gives.
- **Never sum `refund.amount`.** On `succeeded` and `dispute_lost` it is the refund's (or the
  dispute's) own amount, which can be more than the figure moved. `applied_amount` is the move.
- `refundDelta` throws an `AmountError` for an `applied_amount` that is not a positive base-unit
  amount, and a `RefundStatusError` (`unknown_refund_status`) for a status this SDK version does
  not know. Thrown from a callback, either answers 500, so fianto retries the delivery: upgrade
  @fianto/sdk rather than skip it.

Refunds are made in the dashboard. Stripe keeps its fee on a card refund: "Stripe's processing
fees from the original transaction aren't returned" (https://docs.stripe.com/refunds.md).

When the merchant's Stripe balance is short, Stripe holds the refund as pending: "If your
available balance doesn't cover the amount of the refund, Stripe holds the refund as pending for
card transactions" (https://docs.stripe.com/refunds.md). A pending refund does not raise
`refunded_amount` until it succeeds.

### Disputes

A cardholder can dispute a card payment. `payment.disputed` (`onPaymentDisputed`) carries the
payment and `dispute: { id, status, amount, due_by }`, and fires when a dispute opens and each
time its `status` changes: `needs_response`, `under_review`, `won`, `lost`, `accepted` (the
merchant accepted it, so it counts as lost) or `closed`. Disputes are answered in the dashboard.

A lost dispute raises `refunded_amount` (`payment.refunded`, `dispute_lost`), and a late win lowers
it again (`reversed`). No refund can be made while the dispute is open: "You can't issue a refund
outside the dispute process while the dispute is open"
(https://docs.stripe.com/disputes/how-disputes-work.md).

### Card subscriptions

The merchant switches card subscriptions on in the dashboard, separately from card payments, by
accepting their terms. Until they do, every subscription is crypto. A card subscription sends the
same `subscription.*` events.
Its `method` is `'card'`, `currency` `"USD"`, fees `"0"`, `plan_id` null, `customer.wallet` null,
and `card` is the saved card (`{ brand, last4 }`, either half nullable). Its charge's
`payment.signature` is null. A failed charge's `failure.reason` can also be `CARD_DECLINED`,
`CARD_EXPIRED`, `CARD_UNUSABLE`, `AUTHENTICATION_REQUIRED`, `GATEWAY_ERROR` or
`GATEWAY_UNAVAILABLE`. Branch on `data.method === 'card'`, then `else`, as above.

### Test mode

A test key (`fian_sk_test_…`) uses the devnet sandbox, and card payments there use Stripe test
mode. Nothing is set per rail. The merchant connects Stripe test keys on the devnet dashboard,
separately from the live keys on mainnet. Pay with the test card `4242 4242 4242 4242`: "Use a
valid future date, such as 12/34" and "Use any three-digit CVC (four digits for American Express
cards)" (https://docs.stripe.com/testing.md).

To try a handler without a payment, `fianto trigger order.paid --forward-to <url> --method card`
(see `@fianto/cli`)
or `sampleEvent('order.paid', { method: 'card' })` (see [Testing](#testing)) builds the card form
of an event.

### What is not in the API

Refunds, disputes, Stripe balances and payouts are dashboard only: the v1 API has no route for
them. Your server reads their effect through `payment.refunded`, `payment.disputed` and each
payment's `refunded_amount` / `refund_status`.

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
  refused with `WebhookVerificationError('invalid_secret')`. An explicit `options.secret` is
  validated once, at handler construction (a misconfigured route fails when it's set up, not on
  the first delivery); one left to `process.env.FIANTO_WEBHOOK_SECRET` is read and validated
  per request instead (construction can't see an env var that might be set later), so a missing
  or malformed one there fails every delivery with `400 {"error":"invalid_webhook"}` — wire
  `onVerificationError` to see why (see [The generic handler](#the-generic-handler)).

## Money safety

A browser redirect back to your `success_url`, or a popup reporting success, is **not proof of
payment** — it only means the customer's browser believes the checkout finished. Fulfil an order
only on a verified `order.paid` (or `checkout.session.completed`) webhook, or an explicit
server-side `fianto.orders.retrieve(id)` / `fianto.checkoutSessions.retrieve(id)` call that shows
a paid status. Never tell a customer "nothing was charged" based on the browser's view alone —
you cannot see from there whether a transaction is still confirming on-chain, or a card payment
still settling. A paid order is not final either: it can be refunded, and a card payment can be
disputed (see [Card payments](#card-payments)).

## Troubleshooting

- **`Missing appId: pass it to new Fianto({ appId }) or set FIANTO_APP_ID.`** (or `appSecret`) —
  the named env var isn't set and no option was passed.
- **`401` / `code: 'invalid_api_credentials'`** — wrong `appId`/`appSecret` pair, or credentials
  for the wrong deployment (see the next point).
- **`401` / `code: 'api_key_wrong_network'`** — a real key sent to the other network's API: a
  test key (`fian_sk_test_`) to mainnet, or a live key (`fian_sk_live_`) to devnet. Use the key for
  that network. The client catches this before any request when the key has a known prefix and
  the network or base URL is fianto's; you see it from the API otherwise (for example through a
  proxy or a custom `baseUrl`).
- **`403` / `code: 'merchant_not_approved'`, `409` / `code: 'checkout_wallet_required'`** — the
  devnet sandbox, with the test key of a merchant still onboarding. Until an admin approves the
  merchant, only some routes answer that key (the others answer `merchant_not_approved`), and a
  checkout session needs a test wallet set in the devnet dashboard first
  (`checkout_wallet_required`). Mainnet never answers either.
- **Webhook signature verification fails intermittently or always** — almost always a re-encoded
  body: a body parser (`express.json()`, a proxy that decompresses/re-serialises, a framework
  that string-decodes non-UTF-8 bytes) ran before your handler and handed you bytes that differ
  from what fianto signed. Read the raw body yourself, before any parser touches it (see the
  Express adapter's README for the concrete fix).
- **Requests succeed against the wrong environment** — `baseUrl` defaults to the API of the key's
  network (the production API, `https://api.fianto.xyz`, for a live key), so a self-hosted or local backend needs an explicit
  `FIANTO_BASE_URL` (or the `baseUrl` option), e.g. `http://localhost:3000` while running the
  backend yourself. Double check it (and `FIANTO_APP_ID`/`FIANTO_APP_SECRET`) match the
  deployment you intend.

- **`err instanceof RateLimitError` (or any other specific subclass) is false for an error you
  know came from the SDK** — the package ships both ESM and CommonJS builds, so an app that
  loads `@fianto/sdk` through both `require` and `import` (directly or via a dependency) gets two
  copies with two sets of classes; a subclass check still uses the ordinary prototype chain and
  can miss across copies. `err instanceof FiantoError` itself doesn't have this problem (see
  [Errors](#errors)); for a specific subclass or code, use `isFiantoError(err, code)` /
  `isAPIError(err)` instead of `instanceof`.

## License

MIT
