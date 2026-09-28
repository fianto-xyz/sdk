# @fianto/express

Express middleware for fianto webhooks and checkout. A thin wrapper over
`@fianto/sdk/handlers`: same options, same behaviour, bridged onto Express's request/response.

```bash
pnpm add @fianto/express @fianto/sdk
```

Peer dependency: `express >= 4`.

## Usage

```ts
import express from 'express';
import { checkout, webhooks } from '@fianto/express';

const app = express();

// Mount BEFORE express.json() / express.urlencoded() — see "Mount before a body parser" below.
app.post(
  '/webhooks/fianto',
  webhooks({
    secret: process.env.FIANTO_WEBHOOK_SECRET,
    onOrderPaid: async (event) => {
      // dedupe on event.id in the same DB transaction as your side effect — see @fianto/sdk's README
    },
  }),
);

app.post(
  '/api/checkout',
  checkout({
    createSession: async (request) => {
      // Decide price and order_id HERE, on your server — never trust them from the request body.
      const cart = await loadCartForSession(request);
      return {
        mode: 'payment',
        order_id: cart.orderId,
        amount: cart.totalUsdc,
        success_url: 'https://shop.example/thank-you',
        cancel_url: 'https://shop.example/cart',
      };
    },
  }),
);

// A body parser for your OTHER routes is fine after this point.
app.use(express.json());

app.listen(3000);
```

`webhooks(opts)` and `checkout(opts)` return an Express `RequestHandler`. Every option is
`@fianto/sdk`'s — see
[its README](https://github.com/fianto-xyz/sdk/tree/master/packages/sdk#readme) for the full
option tables, the webhook event list, the dedupe pattern, retries and errors.

## Mount before a body parser

Webhook signature verification and the checkout route both need the **exact bytes** the client
sent. The middleware reads the raw request stream itself the first time anything touches it — so
if `express.json()`, `express.urlencoded()`, or any other body parser runs first, the stream is
already consumed and turned into a parsed object the fianto middleware can no longer verify.
Mounting `webhooks()`/`checkout()` after such a parser fails loudly (HTTP `500`, and a message
telling you to move the mount point) rather than silently verifying the wrong bytes.

Fix it either by mounting the fianto route **before** the app-wide parser:

```ts
app.post('/webhooks/fianto', webhooks({ secret })); // first
app.use(express.json()); // then everything else
```

or, if you need the parser mounted globally, give the fianto route
`express.raw({ type: '*/*' })` so it receives an untouched `Buffer` instead of a parsed body:

```ts
app.use(express.json()); // global, for other routes
app.post('/webhooks/fianto', express.raw({ type: '*/*' }), webhooks({ secret }));
```

### Express 4

The same rule applies under Express 4, with one extra trap: `express.json()` /
`express.urlencoded()` on Express 4 set `req.body = {}` for a request with no matching body,
which looks like "already parsed" to this middleware even when nothing meaningful ran. Mount the
fianto handler before the global body parser, or give its route `express.raw({ type: '*/*' })`,
exactly as above — don't rely on the parser skipping unrecognised content types.

## Payload size

The middleware reads at most 1 MiB from an unparsed request body before answering
`413 {"error":"payload_too_large"}` (fianto's own webhook and checkout payloads are well under
this).

## Money safety

A browser redirect back to your `success_url` is not proof of payment. Fulfil orders only from a
verified webhook (`onOrderPaid`) or a server-side `fianto.orders.retrieve(id)` call — never from
the redirect alone.

## Troubleshooting

See `@fianto/sdk`'s README for the shared list (missing env vars, `401 invalid_api_credentials`,
devnet vs. mainnet `baseUrl`). Express-specific:

- **`500` with "mount the fianto handler before express.json()"** — see
  [Mount before a body parser](#mount-before-a-body-parser) above.
- **Webhook signature never verifies even when mounted first** — check for a reverse proxy
  (nginx, an API gateway) ahead of Express that decompresses or re-encodes the body; verification
  needs the exact bytes fianto signed.
- **Checkout route always answers `403`** — a form or `fetch` call is posting cross-site. Pass
  `allowedOrigins` if you intentionally call it from another origin you control.
- **Checkout route answers `403` behind a TLS-terminating proxy** — Express sees `http://` and
  the internal host, so the request's own origin never matches the browser's `https://` `Origin`.
  Set `app.set('trust proxy', …)` to match your proxy setup, or pass
  `allowedOrigins: ['https://shop.example']`.

## License

MIT
