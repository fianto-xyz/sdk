# @fianto/js

The browser SDK for [fianto](https://fianto.xyz): open hosted checkout in a popup from a plain
`<script>` tag or a bundler, and the branded `<fianto-button>` "Pay with fianto" button. No
build step required.

```bash
pnpm add @fianto/js
```

This package never talks to your app secret — it only opens the hosted checkout page your
server already created a session for. For creating that session (and verifying webhooks), see
[`@fianto/sdk`](https://github.com/fianto-xyz/sdk/tree/master/packages/sdk#readme), which runs
on your server.

## Zero-build: `<fianto-button>` from a CDN `<script>`

```html
<script src="https://cdn.jsdelivr.net/npm/@fianto/js/dist/fianto-button.global.iife.js"></script>

<fianto-button session-endpoint="/api/checkout"></fianto-button>

<script>
  document.querySelector('fianto-button').addEventListener('fianto:result', (event) => {
    // event.detail = { status, session_id } — see "The four statuses" below before acting on this.
    console.log(event.detail.status);
  });
  document.querySelector('fianto-button').addEventListener('fianto:error', (event) => {
    // event.detail = { code, message }
    console.error(event.detail.code, event.detail.message);
  });
</script>
```

`session-endpoint` is `POST`ed on click (`credentials: 'same-origin'`, a JSON body made of the
element's `data-*` attributes) and must answer `{ id, url }` — exactly what
`createCheckoutHandler` from `@fianto/sdk/handlers` (or `Checkout()` from `@fianto/nextjs`)
returns. The script also exposes
`window.Fianto.openCheckout` and `window.Fianto.redirectToCheckout` for pages with no bundler
that want the imperative API directly.

## Install (bundler)

```ts
import { openCheckout, redirectToCheckout } from '@fianto/js';
import '@fianto/js/button'; // registers <fianto-button>, if you use it as markup instead
```

## `openCheckout`

```ts
const result = await openCheckout({
  session: () => fetch('/api/checkout', { method: 'POST' }).then((r) => r.json()), // or { id, url }
  fallback: 'redirect', // 'redirect' (default) | 'none'
  popup: { width: 480, height: 720 }, // default
});
// result: { status: 'succeeded' | 'canceled' | 'expired' | 'closed', session_id: string }
```

**Call it synchronously inside a click handler** — it opens the popup with `window.open` before
awaiting anything, so the browser's popup blocker still treats it as a direct response to the
user gesture:

```tsx
<button
  onClick={() => {
    openCheckout({ session: () => createCheckoutSession(orderId) }).then((result) => {
      /* ... */
    });
  }}
>
  Pay
</button>
```

`session` may be `{ id, url }` you already have, or a function returning a `Promise` of it —
call your server's checkout route (built with `createCheckoutHandler` from `@fianto/sdk/handlers`,
`Checkout()` from `@fianto/nextjs`, or `checkout()` from `@fianto/hono` / `@fianto/express`) from
inside that function; never construct the URL yourself.

If the popup is blocked (`window.open` returns `null`): `fallback: 'redirect'` (the default)
awaits `session` and navigates the whole page to its `url` (the returned promise normally never
resolves — the page is leaving; if the payer comes back through the browser's back/forward cache
it resolves `closed`, i.e. unknown); `fallback: 'none'` rejects with `PopupBlockedError` instead. A
session is created at most once either way, and a second `openCheckout()` call while one is
still open reuses the same popup — the first call's promise then resolves `closed` rather than
hanging.

A checkout superseded by another `openCheckout()` call resolves `closed` (unknown — never "nothing was charged").

### `redirectToCheckout`

```ts
await redirectToCheckout({ id, url }); // or a () => Promise<{ id, url }>
```

Skips the popup entirely and sends the whole page to hosted checkout. Use it for a full-page
checkout flow instead of a popup.

### The four statuses (money safety)

- **`succeeded`** — the payer's transaction was confirmed **on the checkout page**. This is
  **not proof of payment or settlement**. Fulfil the order only from a verified `order.paid` (or
  `checkout.session.completed`) webhook, or an explicit server-side
  `fianto.orders.retrieve(id)` / `fianto.checkoutSessions.retrieve(id)` call — never from this
  status alone.
- **`canceled`** — the payer canceled on the checkout page.
- **`expired`** — the session expired before payment.
- **`closed`** — **unknown**. The popup was closed (by the payer, a browser extension, or
  anything else) without ever posting a result back. Never tell the payer "nothing was charged"
  on this status — you cannot see from the browser whether a transaction is still confirming
  on-chain. Reconcile from the order/session state, not from this promise.

### Constraints

- **Results only arrive when the page that called `openCheckout` is on the origin of the
  session's `success_url`.** The checkout page posts its result to that origin specifically; on
  any other origin nothing is delivered and the call resolves `closed` once the payer closes the
  popup.
- **`Cross-Origin-Opener-Policy: same-origin` on your page severs `window.opener`** and the
  checkout page never posts to it — set `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  instead (never plain `same-origin`) on any page that calls `openCheckout`.
- Call `openCheckout` (or click the button) **inside the event handler**, synchronously — not
  after an `await`, a `setTimeout`, or from a `useEffect` — or the browser's popup blocker treats
  it as unsolicited and blocks it.
- Popup blocked and `fallback: 'redirect'` navigates away; there is nothing further to render.

## `<fianto-button>`

```html
<fianto-button session-endpoint="/api/checkout" theme="brand" label="pay"></fianto-button>
```

or set the `session` property directly from script instead of `session-endpoint`:

```ts
document.querySelector('fianto-button').session = () => createCheckoutSession(orderId);
```

Events (bubbling, composed — listen at any ancestor): `fianto:result` (`detail: { status,
session_id }`, the same four statuses as `openCheckout` — read [Money safety](#the-four-statuses-money-safety)
above before acting on `succeeded`), `fianto:error` (`detail: { code, message }`; a `409
payment_in_progress` from your checkout route shows "A payment for this order is already in
progress").

### Options

| Attribute | Values | Default |
|---|---|---|
| `theme` | `brand` (fianto blue, white logo), `dark`, `light`, `outline`, `auto` (follows `prefers-color-scheme`: dark → `dark`, light → `brand`) | `brand` |
| `label` | `plain` (logo only), `pay`, `buy`, `checkout`, `subscribe`, `donate` — "Pay with ▣ fianto", "Buy with ▣ fianto", etc. | `pay` |
| `shape` | `rect`, `rounded`, `pill` | `rounded` |
| `size` | `static`, `fill` (100% width) | `static` |
| `locale` | `en`, `vi`; anything else falls back to the `navigator.language` base language, then `en` | auto |
| `session-endpoint` | URL `POST`ed on click (`credentials: 'same-origin'`, JSON body = the element's `data-*` attributes); must answer `{ id, url }` | — |
| `fallback` | `redirect`, `none` — see [`openCheckout`](#opencheckout) | `redirect` |
| `disabled` | boolean attribute | — |

The `session` property (a `{ id, url }` or a `() => Promise<{ id, url }>`) overrides
`session-endpoint` when both are set.

### CSS custom properties

Set these on the `<fianto-button>` element itself (they cross into its shadow root):

| Property | Range | Default |
|---|---|---|
| `--fianto-button-height` | clamped to 40–55px | `44px` |
| `--fianto-button-radius` | clamped to 0–(height / 2); overrides `shape` | set by `shape` |
| `--fianto-button-width` | any CSS width | `auto` (or 100% when `size="fill"`) |
| `--fianto-button-focus-ring` | any CSS color | `#0002F8` |

### What is locked, and why

Like PayPal, Apple Pay, Google Pay and Shop Pay lock their own buttons, `<fianto-button>` locks
its logo color, size and position, its wordmark, and its label text — you cannot pass arbitrary
label strings or backgrounds. This keeps "Pay with fianto" recognizable and trustworthy across
every site that embeds it, the same reason those other brands lock theirs. If a localized label
would overflow the button's width, it silently falls back to the logo-only `plain` layout rather
than clipping or wrapping.

### Accessibility

- Renders a native `<button>`, so it gets built-in keyboard and screen-reader button semantics
  for free.
- Accessible name (`aria-label`) is the localized label, e.g. "Pay with fianto".
- A 2px focus ring at ≥ 3:1 contrast on keyboard focus (`--fianto-button-focus-ring` to
  restyle it).
- `aria-busy="true"` plus a spinner from click until the popup resolves; the accessible name is
  unaffected by the loading state.
- Leave clear space of at least `height / 10` around the button (e.g. ~4.4px at the default
  44px height) — like the CSS custom properties, this is the host page's responsibility; the
  button does not reserve margin for itself.

## Troubleshooting

- **`fianto:result` never fires; the popup just closes** — you're listening on a different
  origin than the session's `success_url`. Results only post to that origin (see
  [Constraints](#constraints)).
- **The popup opens blank, then nothing happens** — check `Cross-Origin-Opener-Policy` on the
  page that called `openCheckout`/clicked the button: `same-origin` (rather than
  `same-origin-allow-popups`) severs `window.opener` before the checkout page can post its
  result.
- **The popup is blocked every time** — `openCheckout` (or the button's click handler) is not
  running synchronously inside the click. An `await` or `setTimeout` before `window.open` loses
  the "direct response to a user gesture" the browser requires.
- **The button falls back to logo-only unexpectedly** — the localized label overflowed the
  button's available width (see [What is locked](#what-is-locked-and-why)); widen the button or
  switch `label` to a shorter option.

## Money safety

Read [The four statuses](#the-four-statuses-money-safety) above. In short: `succeeded` means the
payer's browser saw the checkout page confirm — not that the payment settled; `closed` means
**unknown**, never "nothing was charged". Fulfil orders only from a verified webhook or a
server-side retrieve call, both documented in `@fianto/sdk`'s README.

## License

MIT
