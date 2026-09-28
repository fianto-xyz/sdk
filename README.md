# fianto

The developer SDK for [fianto](https://fianto.xyz): accept Solana USDC payments with a hosted
checkout page, verify webhooks, and read back orders, payments and subscriptions from your own
server. There is no publishable/browser key — the browser only ever talks to a checkout session
your server already created.

## Packages

| Package | What it's for |
|---|---|
| [`@fianto/sdk`](packages/sdk#readme) | The server client: typed API resources (`checkoutSessions`, `orders`, `payments`, `subscriptions`, `products`, `prices`, `events`), Standard Webhooks verification (`@fianto/sdk/webhooks`), and framework-agnostic checkout/webhook route handlers (`@fianto/sdk/handlers`). |
| [`@fianto/nextjs`](packages/nextjs#readme) | `Webhooks()` and `Checkout()` — Next.js App Router route handlers over `@fianto/sdk/handlers`. |
| [`@fianto/hono`](packages/hono#readme) | `webhooks()` and `checkout()` for [Hono](https://hono.dev) — works on Cloudflare Workers, Bun, Deno and Node. |
| [`@fianto/express`](packages/express#readme) | `webhooks()` and `checkout()` Express middleware. |
| [`@fianto/js`](packages/js#readme) | The browser SDK: `openCheckout`/`redirectToCheckout`, and the branded `<fianto-button>` custom element (also a zero-build CDN bundle). |
| [`@fianto/react`](packages/react#readme) | `useCheckout()` and `<FiantoButton>`, built on `@fianto/js`. |
| [`@fianto/cli`](packages/cli#readme) | The `fianto` command line: check application status, inspect events, forward them to `localhost` for development, trigger and sign test events. |

Each README covers installation, configuration, every option, errors and troubleshooting for its
package in full — this page is a map and a 5-minute quickstart.

## Quickstart

This is the Next.js path end to end; the same three pieces (create a session, render a button,
verify the webhook) exist for [Hono](packages/hono#readme) and
[Express](packages/express#readme) too. A complete, runnable version of it lives in
[`examples/nextjs-app`](examples/nextjs-app#readme).

```bash
pnpm add @fianto/nextjs @fianto/react @fianto/sdk
```

**1. A checkout route on your server** (`app/api/checkout/route.ts`) — this is the only place
that decides the price and the order id; never trust either from the browser:

```ts
import { Checkout } from '@fianto/nextjs';

// Your own cart lookup — a stand-in so this example type-checks; not part of @fianto/nextjs.
declare function loadCartForSession(
  request: Request,
): Promise<{ orderId: string; totalUsdc: string; description: string }>;

export const POST = Checkout({
  createSession: async (request) => {
    const cart = await loadCartForSession(request);
    return {
      mode: 'payment',
      order_id: cart.orderId,
      amount: cart.totalUsdc, // decimal USDC string, e.g. "10.00"
      description: cart.description, // required alongside amount
      success_url: 'https://shop.example/thank-you',
      cancel_url: 'https://shop.example/cart',
    };
  },
});
```

**2. A button that opens it** (a client component, e.g. `app/checkout-button.tsx`):

```tsx
'use client';

import { FiantoButton, fetchCheckoutSession } from '@fianto/react';

export function CheckoutButton({ orderId }: { orderId: string }) {
  return (
    <FiantoButton
      session={() => fetchCheckoutSession('/api/checkout', { body: { orderId } })}
      theme="brand"
      label="pay"
      onResult={(result) => {
        // result.status — see "Money safety" below before acting on 'succeeded'
      }}
    />
  );
}
```

**3. A webhook route that actually fulfils the order** (`app/api/webhooks/fianto/route.ts`) —
this, not the button, is where you mark an order paid:

```ts
import { Webhooks } from '@fianto/nextjs';

export const POST = Webhooks({
  secret: process.env.FIANTO_WEBHOOK_SECRET,
  onOrderPaid: async (event) => {
    // dedupe on event.id in the same DB transaction as this write — see @fianto/sdk's README
  },
});
```

**4. Test it locally**, without registering a public endpoint yet — forward your account's real
events to that route with the CLI:

```bash
FIANTO_APP_ID=fian_app_... FIANTO_APP_SECRET=fian_sk_... \
  npx @fianto/cli events tail --forward-to http://localhost:3000/api/webhooks/fianto --secret whsec_...
```

(`events tail` polls your account's events, so — unlike `trigger`/`sign` — it needs your app
credentials too, from **Dashboard → Developers → Applications**, alongside the webhook secret.)

Click the button, pay in the popup, and watch `onOrderPaid` fire. See
[`@fianto/cli`'s README](packages/cli#readme) for every command.

## Supported runtimes

- **`@fianto/sdk`** (server): anywhere with `fetch` and Web Crypto — Node.js ≥ 20.3, Bun, Deno,
  Cloudflare Workers, Vercel Edge. No Node-only APIs are used in the request path. Node.js 20
  reached its own end of life in April 2026 (no more upstream security patches); 20.3+ still
  works and is verified in CI, but Node.js 22+ (the current LTS) is recommended for anything new.
- **`@fianto/nextjs`**: `next >= 15`, Node.js and Edge runtimes alike.
- **`@fianto/hono`**: `hono >= 4`, including Cloudflare Workers, Bun and Deno.
- **`@fianto/express`**: `express >= 4`, Node.js.
- **`@fianto/js`** / **`@fianto/react`**: any modern browser (Safari 13.1+, Chrome 80+, Firefox
  74+, Edge 80+ — see [`@fianto/js`'s README](packages/js#readme) for the exact floor and its
  bundle sizes); `@fianto/react` needs `react >= 19`.
- **`@fianto/cli`**: a Node.js program, Node.js ≥ 20.3.
- **TypeScript**: 5.0 or newer, for every package's published types.

## Security model

- **Your app secret never leaves your server.** `new Fianto()` throws if constructed where
  `window`/`document` exist, unless you explicitly opt out with `dangerouslyAllowBrowser: true`
  — there is no separate publishable/browser key to hand out instead. The browser only ever
  calls your own checkout route, which itself calls fianto with the secret.
- **Webhooks are verified against the raw request body** (Standard Webhooks: `webhook-id` /
  `webhook-timestamp` / `webhook-signature`, HMAC-SHA256, replay tolerance that cannot be
  disabled). A body parser that re-encodes the bytes before your handler sees them breaks
  verification — see each adapter's README for the exact fix (e.g. mounting the Express handler
  before `express.json()`).
- **The checkout route has a CSRF guard** (`@fianto/sdk/handlers`'s `createCheckoutHandler`,
  used by every adapter): it refuses with `403` before calling the API unless the request passes
  `Sec-Fetch-Site: same-origin` or an allow-listed `Origin`.
- **No publishable key.** `@fianto/js` and `@fianto/react` hold no credential at all — they only
  open the hosted checkout page for a session your server already created.

## Money safety

A browser redirect to your `success_url`, a popup reporting `succeeded`, or a webhook you
haven't verified are none of them proof that a payment settled — they mean a payer's browser (or
an unverified request) claims it did. **Fulfil an order only from a verified `order.paid`** (or
`checkout.session.completed`) **webhook, or an explicit server-side
`fianto.orders.retrieve(id)` / `fianto.checkoutSessions.retrieve(id)` call that shows a paid
status.** Never tell a customer "nothing was charged" from the browser's view alone — a
transaction can still be confirming on-chain when a popup closes or a page reports `closed`. See
[`@fianto/sdk`'s "Money safety"](packages/sdk/README.md#money-safety) and
[`@fianto/js`'s "Money safety"](packages/js/README.md#money-safety) for the full detail behind
every status the browser SDK can report.

## Examples

- [`examples/nextjs-app`](examples/nextjs-app#readme) — `@fianto/nextjs` + `@fianto/react`, a
  subscription checkout end to end.
- [`examples/express-server`](examples/express-server#readme) — `@fianto/express` with a plain
  `<script>`-tag `<fianto-button>`, no bundler.

## Contributing and releases

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow, and how a change gets
released (CI on every PR, a [Changesets](https://github.com/changesets/changesets) "Version
packages" PR, then an npm publish once it merges and CI passes). The first push to master
publishes 0.1.0 once CI passes — create the @fianto npm org and the NPM_TOKEN secret first; later
releases go through the Changesets 'Version packages' PR.

## Security

See [`SECURITY.md`](SECURITY.md) to report a vulnerability, or for the supported-versions policy.

## License

[MIT](LICENSE)
