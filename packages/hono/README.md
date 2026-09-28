# @fianto/hono

[Hono](https://hono.dev) handlers for fianto webhooks and checkout — works unmodified on
Cloudflare Workers, Bun, Deno and Node. A thin wrapper over `@fianto/sdk/handlers`: same
options, same behaviour, adapted to Hono's `Context`.

```bash
pnpm add @fianto/hono @fianto/sdk
```

Peer dependency: `hono >= 4`.

## Usage

```ts
import { Hono } from 'hono';
import { checkout, webhooks } from '@fianto/hono';

const app = new Hono();

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

export default app;
```

`webhooks(opts)` and `checkout(opts)` return `(c: Context) => Promise<Response>`, calling
`@fianto/sdk/handlers` with `c.req.raw` — Hono's underlying Fetch `Request`, unread and
unmodified. Every option is `@fianto/sdk`'s — see
[its README](https://github.com/fianto-xyz/sdk/tree/master/packages/sdk#readme) for the full
option tables, the webhook event list, the dedupe pattern, retries and errors.

## Workers and Bun notes

Both handlers only use `fetch`/`Request`/`Response`/Web Crypto, so they run unchanged on
Cloudflare Workers and Bun — no Node polyfills needed. On Workers, set `FIANTO_APP_ID`,
`FIANTO_APP_SECRET`, `FIANTO_BASE_URL` and `FIANTO_WEBHOOK_SECRET` as Worker secrets/vars and
read them via `c.env` into the options instead of `process.env`, since Workers has no `process`:

```ts
app.post('/webhooks/fianto', (c) =>
  webhooks({ secret: c.env.FIANTO_WEBHOOK_SECRET, onOrderPaid })(c),
);
```

## Money safety

A browser redirect back to your `success_url` is not proof of payment. Fulfil orders only from a
verified webhook (`onOrderPaid`) or a server-side `fianto.orders.retrieve(id)` call — never from
the redirect alone.

## Troubleshooting

See `@fianto/sdk`'s README for the shared list (missing env vars, `401 invalid_api_credentials`,
devnet vs. mainnet `baseUrl`). Hono-specific:

- **Webhook signature never verifies** — make sure no earlier middleware (`app.use(...)`) reads
  or replaces the request body before `webhooks()` runs; `c.req.raw` must still be the untouched
  request.
- **Checkout route always answers `403`** — a form or `fetch` call is posting cross-site. Pass
  `allowedOrigins` if you intentionally call it from another origin you control.

## License

MIT
