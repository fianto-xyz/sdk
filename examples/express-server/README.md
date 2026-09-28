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
| `FIANTO_APP_ID` / `FIANTO_APP_SECRET` | Your app's credentials, from **Dashboard → Developers → Applications**. Server-side only. |
| `FIANTO_BASE_URL` | Optional. The fianto deployment these credentials belong to; defaults to the production API (`https://api.fianto.xyz`). Point it at a local backend (e.g. `http://localhost:3000`) instead — there's no separate "devnet" API host. |
| `FIANTO_WEBHOOK_SECRET` | The signing secret for the endpoint you register at `/webhooks/fianto`. |
| `PORT` | Optional; defaults to `3100`. |
| `SITE_URL` | Optional. This app's own public origin, used to build `success_url`/`cancel_url` (`src/app.ts`). Required (`https://`) once deployed — falls back to the incoming request's own origin otherwise, which only works for local development. |

## Run

```bash
pnpm --filter express-server dev
```

Then open http://localhost:3100.

To receive webhooks locally, forward events from your fianto dashboard's event log to this
server with the CLI (from the repo root, in another terminal):

```bash
npx @fianto/cli events tail --forward-to http://localhost:3100/webhooks/fianto --secret whsec_...
```

(the same value as `FIANTO_WEBHOOK_SECRET` above — `events tail` doesn't read your `.env`, so
pass it with `--secret` or export it: `export FIANTO_WEBHOOK_SECRET=whsec_...`).

## Money safety

The button's `succeeded` status means the payer's browser saw checkout finish **on the checkout
page** — it is not proof of payment or settlement. This example only logs fulfilment inside the
webhook handler (`onOrderPaid`, `onSubscriptionRenewed`, in `src/app.ts`); a real app would write
to its database there, deduped on `event.id` in the same transaction as the write (delivery is
at-least-once and unordered). The `closed` status means **unknown**, not "nothing was charged" —
never tell a payer nothing was charged based on the browser's view alone. `canceled` isn't proof
of that either — a transaction the payer already built can still land after they clicked
"cancel" — and `expired` never says just "try again" without pointing the payer at their order
status first (see `public/index.html`'s `COPY`). See `@fianto/sdk`'s and `@fianto/js`'s READMEs
for the full detail behind every status.
