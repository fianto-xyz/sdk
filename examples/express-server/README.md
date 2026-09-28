# fianto Express example

An Express server with a plain `<script>`-tag `<fianto-button>` in a static HTML page — no
bundler, no framework beyond Express itself:

- `src/app.ts` — `createApp()` wires up `webhooks()`/`checkout()` from `@fianto/express`
  (mounted **before** `express.json()` — both need the exact request bytes), serves
  `public/index.html`, and serves `@fianto/js`'s CDN bundle at `GET /fianto-button.js` (read
  straight off the installed `@fianto/js` package, not fetched from a CDN, so this example works
  offline).
- `src/server.ts` — starts the server on `PORT` (default 3100).
- `public/index.html` — a `<fianto-button session-endpoint="/api/checkout" data-plan="pro">`
  with `fianto:result` / `fianto:error` listeners showing the money-safe copy for each status.

## Setup

```bash
cp .env.example .env
```

| Env var | Meaning |
|---|---|
| `FIANTO_APP_ID` / `FIANTO_APP_SECRET` | Your app's credentials. Server-side only. |
| `FIANTO_BASE_URL` | Optional. The fianto deployment these credentials belong to; defaults to the production API (`https://api.fianto.xyz`). |
| `FIANTO_WEBHOOK_SECRET` | The signing secret for the endpoint you register at `/webhooks/fianto`. |
| `FIANTO_PRICE_PRO` | Only needed if you adapt the "pro" plan into a subscription price. |
| `PORT` | Optional; defaults to `3100`. |

## Run

```bash
pnpm --filter express-server dev
```

Then open http://localhost:3100.

To receive webhooks locally, forward events from your fianto dashboard's event log to this
server with the CLI (from the repo root, in another terminal):

```bash
npx fianto events tail --forward-to http://localhost:3100/webhooks/fianto
```

## Money safety

The button's `succeeded` status means the payer's browser saw checkout finish **on the checkout
page** — it is not proof of payment or settlement. This example only logs fulfilment inside the
webhook handler (`onOrderPaid`, `onSubscriptionRenewed`, in `src/app.ts`); a real app would write
to its database there, deduped on `event.id` in the same transaction as the write (delivery is
at-least-once and unordered). The `closed` status means **unknown**, not "nothing was charged" —
never tell a payer nothing was charged based on the browser's view alone. See `@fianto/sdk`'s and
`@fianto/js`'s READMEs for the full detail behind both statuses.
