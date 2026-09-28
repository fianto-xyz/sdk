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

// Your own cart lookup — a stand-in so this example type-checks; not part of @fianto/express.
declare function loadCartForSession(
  request: Request,
): Promise<{ orderId: string; totalUsdc: string; description: string }>;

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
    createSession: async (request, { req }) => {
      // Decide price and order_id HERE, on your server — never trust them from the request body.
      // `req` is Express's own request (e.g. `req.user` set by earlier middleware).
      const cart = await loadCartForSession(request);
      return {
        mode: 'payment',
        order_id: cart.orderId,
        amount: cart.totalUsdc,
        description: cart.description, // required alongside amount
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
import express from 'express';
import { webhooks } from '@fianto/express';

const app = express();
const secret = process.env.FIANTO_WEBHOOK_SECRET;

app.post('/webhooks/fianto', webhooks({ secret })); // first
app.use(express.json()); // then everything else
```

or, if you need the parser mounted globally, give the fianto route
`express.raw({ type: '*/*' })` so it receives an untouched `Buffer` instead of a parsed body:

```ts
import express from 'express';
import { webhooks } from '@fianto/express';

const app = express();
const secret = process.env.FIANTO_WEBHOOK_SECRET;

app.use(express.json()); // global, for other routes
app.post('/webhooks/fianto', express.raw({ type: '*/*' }), webhooks({ secret }));
```

### Express 4

The same rule applies under Express 4. `express.json()`/`express.urlencoded()` set `req.body =
{}` (rather than leaving it `undefined`, as Express 5 does) for a request whose content type they
skip — that `{}` is harmless: the middleware only refuses a body whose *stream* was actually
read (`req._body`/`readableDidRead`/`readableEnded`), not merely one with a non-`undefined`
`req.body`, so a parser that ran but didn't match this request still lets it through, and the
bridge reads the raw stream itself. What still needs mounting before the global parser (or its
own `express.raw({ type: '*/*' })`, exactly as above) is a parser that *does* match and actually
consumes the stream — the 500 the middleware answers when that happens names both fixes.

## Payload size

The middleware reads at most 1 MiB (`1_048_576` bytes — fianto's own webhook and checkout
payloads are well under this) from an unparsed request body before answering
`413 {"error":"payload_too_large"}`. Only `webhooks()` lets you change that limit, via its
`maxBodyBytes` option (the same one `@fianto/sdk/handlers`' `createWebhookHandler` takes) — the
Express bridge reads up to `options.maxBodyBytes ?? 1_048_576` for it. `checkout()` has no such
option (`CheckoutHandlerOptions` doesn't take one) and the bridge always reads up to the 1 MiB
default for it. Unlike the underlying webhook handler (which checks the signature headers before
reading any of the body), the Express bridge has to buffer the body itself first, to bridge
Express's stream to a fetch `Request` — bounded by the limit either way, but the 413 it answers
is a bridge-level response and does not call `onVerificationError`.

## Money safety

A browser redirect back to your `success_url` is not proof of payment. Fulfil orders only from a
verified webhook (`onOrderPaid`) or a server-side `fianto.orders.retrieve(id)` call — never from
the redirect alone.

## Troubleshooting

See `@fianto/sdk`'s README for the shared list (missing env vars, `401 invalid_api_credentials`,
self-hosted/local vs. production `baseUrl`). Express-specific:

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
