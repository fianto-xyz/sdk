# @fianto/nextjs

Next.js App Router route handlers for fianto webhooks and checkout. A thin wrapper over
`@fianto/sdk/handlers` — same options, same behaviour, just named for `route.ts`.

```bash
pnpm add @fianto/nextjs @fianto/sdk
```

Peer dependency: `next >= 15`.

## Usage

`app/api/webhooks/fianto/route.ts`:

```ts
import { Webhooks } from '@fianto/nextjs';

export const POST = Webhooks({
  secret: process.env.FIANTO_WEBHOOK_SECRET,
  onOrderPaid: async (event) => {
    // dedupe on event.id in the same DB transaction as your side effect — see @fianto/sdk's README
  },
});
```

`app/api/checkout/route.ts`:

```ts
import { Checkout } from '@fianto/nextjs';

export const POST = Checkout({
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
});
```

`Webhooks(opts)` and `Checkout(opts)` return `(request: Request) => Promise<Response>` — exactly
a Next.js App Router route handler, so `export const POST = Webhooks({...})` is the whole
integration. Every option (`secret`, `toleranceSeconds`, the `on*` callbacks, `onEvent`,
`onVerificationError` for webhooks; `fianto`, `createSession`, `allowedOrigins`, `onError` for
checkout) is `@fianto/sdk`'s — see [its README](https://github.com/fianto-xyz/sdk/tree/master/packages/sdk#readme)
for the full option tables, the webhook event list, the dedupe pattern, retries and errors.

## Money safety

A browser redirect back to your `success_url` is not proof of payment. Fulfil orders only from a
verified webhook (`onOrderPaid`) or a server-side `fianto.orders.retrieve(id)` call — never from
the redirect alone.

## Runtime notes

Both handlers read `request.arrayBuffer()` themselves and need the exact bytes the client sent,
so keep them as plain Route Handlers — do not run middleware in front of them that parses or
rewrites the body. They work in the Node.js runtime and the Edge runtime alike (`fetch` + Web
Crypto only, no Node-only APIs).

## Troubleshooting

See `@fianto/sdk`'s README for the shared list (missing env vars, `401 invalid_api_credentials`,
devnet vs. mainnet `baseUrl`). Next.js–specific:

- **Webhook signature never verifies** — check that nothing ahead of the route handler (a custom
  `middleware.ts`, an edge proxy) reads or rewrites the request body before it reaches `Webhooks()`.
- **Checkout route always answers `403`** — a form or `fetch` call is posting cross-site. The
  guard passes on `Sec-Fetch-Site: same-origin` alone (checked first, sent by the browser); failing
  that, it needs `Origin` present and in `allowedOrigins` (default: the request URL's own origin,
  which behind a reverse proxy can be an internal host rather than your public one). Pass
  `allowedOrigins` explicitly if you intentionally call it from another origin you control, or if
  the caller doesn't send `Sec-Fetch-Site`.
- **Popup opened by `@fianto/js` never closes / reports success** — the popup's origin (the
  hosted checkout page) posts back to whichever origin opened it; make sure the page that calls
  `openCheckout()` is served from the same origin as `success_url`, and see `@fianto/js`'s README
  on `COOP: same-origin-allow-popups`.

## License

MIT
