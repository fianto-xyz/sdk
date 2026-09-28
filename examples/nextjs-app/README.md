# fianto Next.js example

A minimal Next.js App Router app showing an end-to-end subscription checkout with `@fianto/nextjs`
and `@fianto/react`:

- `app/page.tsx` — a Server Component that renders `<PayButton plan="pro" />`.
- `app/pay-button.tsx` — a client component wrapping `@fianto/react`'s `<FiantoButton>`, showing
  the money-safe copy for each of the four checkout statuses.
- `app/api/checkout/route.ts` — `Checkout()` from `@fianto/nextjs`. Decides the price and
  `order_id` **on the server** from a `PLANS` map, never from the request body.
- `app/api/webhooks/fianto/route.ts` — `Webhooks()` from `@fianto/nextjs`. This is where an order
  or subscription actually gets fulfilled.

## Setup

```bash
cp .env.example .env.local
```

| Env var | Meaning |
|---|---|
| `FIANTO_APP_ID` / `FIANTO_APP_SECRET` | Your app's credentials, from **Dashboard → Developers → Applications**. Server-side only. |
| `FIANTO_BASE_URL` | Optional. The fianto deployment these credentials belong to; defaults to the production API (`https://api.fianto.xyz`). Point it at a local backend (e.g. `http://localhost:3000`) instead — there's no separate "devnet" API host. |
| `FIANTO_WEBHOOK_SECRET` | The signing secret for the endpoint you register at `/api/webhooks/fianto`. |
| `FIANTO_PRICE_PRO` | The id of the recurring Price backing the "pro" plan. |
| `SITE_URL` | Optional. This app's own public origin, used to build `success_url`/`cancel_url` (`app/api/checkout/route.ts`). Required (`https://`) once deployed — falls back to the incoming request's own origin otherwise, which only works for local development. |

## Run

```bash
pnpm --filter nextjs-app dev
```

Then open http://localhost:3000.

To receive webhooks locally, forward events from your fianto dashboard's event log to this app
with the CLI (from the repo root, in another terminal):

```bash
npx @fianto/cli events tail --forward-to http://localhost:3000/api/webhooks/fianto --secret whsec_...
```

(the same value as `FIANTO_WEBHOOK_SECRET` above — `events tail` doesn't read your `.env.local`,
so pass it with `--secret` or export it: `export FIANTO_WEBHOOK_SECRET=whsec_...`).

`typecheck` (`pnpm --filter nextjs-app typecheck`, and the workspace root's `pnpm typecheck`)
runs `tsc --noEmit` in CI. `next build` is not run in CI — it needs no network, but it's slow —
so run it locally (`pnpm --filter nextjs-app build`) before shipping a change here.

## Money safety

The checkout button's `succeeded` status means the payer's browser saw checkout finish **on the
checkout page** — it is not proof of payment or settlement. This example only logs fulfilment
inside the webhook handler (`onOrderPaid`, `onSubscriptionRenewed`); a real app would write to its
database there, deduped on `event.id` in the same transaction as the write (delivery is
at-least-once and unordered). The `closed` status means **unknown**, not "nothing was charged" —
never tell a payer nothing was charged based on the browser's view alone. `canceled` isn't proof
of that either — a transaction the payer already built can still land after they clicked
"cancel" — and `expired` never says just "try again" without pointing the payer at their order
status first (see `app/pay-button.tsx`'s `STATUS_COPY`). See `@fianto/sdk`'s and `@fianto/js`'s
READMEs for the full detail behind every status.
