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

Pin an exact version — never `@latest` or an unversioned URL, which can silently start serving a
newer, unaudited build — and set `integrity`/`crossorigin` so the browser refuses the script if
jsdelivr (or anything between you and it) ever serves something other than the bytes you pinned:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@fianto/js@0.1.0/dist/fianto-button.global.iife.js"
  integrity="sha384-REPLACE_WITH_THE_HASH_BELOW"
  crossorigin="anonymous"
></script>

<fianto-button session-endpoint="/api/checkout"></fianto-button>

<script>
  document.querySelector('fianto-button').addEventListener('fianto:result', (event) => {
    // event.detail = { status, session_id, reason? } — see "The four statuses" below before acting on this.
    console.log(event.detail.status);
  });
  document.querySelector('fianto-button').addEventListener('fianto:error', (event) => {
    // event.detail = { code, message }
    console.error(event.detail.code, event.detail.message);
  });
</script>
```

Compute the `integrity` hash for whichever version you pin (this one, for `0.1.0`):

```bash
curl -s https://cdn.jsdelivr.net/npm/@fianto/js@0.1.0/dist/fianto-button.global.iife.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

then set `integrity` to `sha384-` followed by that output. Recompute it (and re-pin the version
in the URL) whenever you upgrade — that's what pinning buys you: an upgrade is something you
choose and re-verify, not something jsdelivr can push to you silently.

`session-endpoint` is `POST`ed on click (`credentials: 'same-origin'`, a JSON body made of the
element's `data-*` attributes) and must answer `{ id, url }` — exactly what
`createCheckoutHandler` from `@fianto/sdk/handlers` (or `Checkout()` from `@fianto/nextjs`)
returns. The script also exposes
`window.Fianto.openCheckout`, `window.Fianto.redirectToCheckout`,
`window.Fianto.fetchCheckoutSession` and `window.Fianto.focusCheckout` for pages with no bundler
that want the imperative API directly.

## Install (bundler)

```ts
import { openCheckout, redirectToCheckout } from '@fianto/js';
import '@fianto/js/button'; // registers <fianto-button>, if you use it as markup instead
```

`@fianto/js/button-core` is internal: it holds the button's markup, styles and copy shared with
`@fianto/react`, and may change in any release. Don't import it.

## `openCheckout`

```ts
import { fetchCheckoutSession, openCheckout } from '@fianto/js';

declare const orderId: string;

const result = await openCheckout({
  session: () => fetchCheckoutSession('/api/checkout', { body: { orderId } }), // or { id, url }
  fallback: 'redirect', // 'redirect' (default) | 'none'
  popup: { width: 480, height: 720 }, // default
});
// result: { status: 'succeeded' | 'canceled' | 'expired', session_id }
//       | { status: 'closed', reason, session_id } — reason: see "The four statuses" below
```

**Call it synchronously inside a click handler** — it opens the popup with `window.open` before
awaiting anything, so the browser's popup blocker still treats it as a direct response to the
user gesture:

```tsx
import { fetchCheckoutSession, openCheckout, type CheckoutResult } from '@fianto/js';

declare const orderId: string;

function PayButton() {
  return (
    <button
      onClick={() => {
        openCheckout({ session: () => fetchCheckoutSession('/api/checkout', { body: { orderId } }) }).then(
          (result: CheckoutResult) => {
            /* ... */
          },
        );
      }}
    >
      Pay
    </button>
  );
}
```

`session` may be `{ id, url }` you already have, or a function returning a `Promise` of it —
call your server's checkout route (built with `createCheckoutHandler` from `@fianto/sdk/handlers`,
`Checkout()` from `@fianto/nextjs`, or `checkout()` from `@fianto/hono` / `@fianto/express`) from
inside that function; never construct the URL yourself.

### `fetchCheckoutSession`

```ts no-check
// Pseudo-signature — see the real one below.
fetchCheckoutSession(endpoint, { body?, headers?, credentials?, signal? }) → Promise<{ id, url }>
```

`POST`s `body` as JSON (default `{}`, `credentials: 'same-origin'`) to your checkout route and
returns its `{ id, url }`. When the route refuses, it rejects with a `CheckoutSessionError`:

| Field | Value |
|---|---|
| `code` | the route's `error.code` — e.g. `payment_in_progress` (409), `order_already_paid` (409), `order_session_mismatch` (409), `checkout_unavailable` (409), `rate_limited` (429), a validation code for your own params, `internal_error` (500); or `network_error` (no response) / `session_request_failed` (an error status with no `{ error: { code } }` body) |
| `status` | the HTTP status |
| `retryAfter` | the `Retry-After` header in seconds, when sent |
| `message` | the route's message — written for you, not for the payer |

Use it rather than `fetch(...).then((r) => r.json())`: that turns every refusal into a body
`openCheckout` has to guess at. (`openCheckout` still recognises a `{ error: { code } }` body
handed to it that way and rejects with a `CheckoutSessionError` of that code, without `status`.)

### `focusCheckout`

`focusCheckout()` brings the popup of the checkout in progress to the front and returns `true`,
or returns `false` when there is none. Call it when the payer clicks your busy pay button again
— the popup has probably gone behind the page — instead of opening a second checkout.
`<fianto-button>` and `@fianto/react`'s `<FiantoButton>` already do.

If the popup is blocked (`window.open` returns `null`): `fallback: 'redirect'` (the default)
awaits `session` and navigates the whole page to its `url` (the returned promise normally never
resolves — the page is leaving; if the payer comes back through the browser's back/forward cache
it resolves `closed`, i.e. unknown); `fallback: 'none'` rejects with `PopupBlockedError` instead. A
session is created at most once either way, and a second `openCheckout()` call while one is
still open reuses the same popup — the first call's promise then resolves `closed` rather than
hanging.

A checkout superseded by another `openCheckout()` call resolves `closed` with `reason:
'superseded'` (unknown — never "nothing was charged").

### `redirectToCheckout`

```ts
import { redirectToCheckout } from '@fianto/js';

declare const id: string;
declare const url: string;

await redirectToCheckout({ id, url }); // or a () => Promise<{ id, url }>
```

Skips the popup entirely and sends the whole page to hosted checkout. Use it for a full-page
checkout flow instead of a popup. The promise normally never settles (the page is leaving); if
the payer comes back through the browser's back/forward cache it resolves `{ status: 'closed',
reason: 'returned_from_redirect' }`, so a spinner you showed can stop.

### The four statuses (money safety)

- **`succeeded`** — the payer's transaction was confirmed **on the checkout page**. This is
  **not proof of payment or settlement**. Fulfil the order only from a verified `order.paid` (or
  `checkout.session.completed`) webhook, or an explicit server-side
  `fianto.orders.retrieve(id)` / `fianto.checkoutSessions.retrieve(id)` call — never from this
  status alone.
- **`canceled`** — the payer canceled on the checkout page.
- **`expired`** — the session expired before payment.
- **`closed`** — **unknown**. No result was posted back. Never tell the payer "nothing was
  charged" on this status — you cannot see from the browser whether a transaction is still
  confirming on-chain. Reconcile from the order/session state, not from this promise. `reason`
  says why:
  - `closed_by_payer` — the popup was closed (by the payer, a browser extension, anything) after
    checkout had loaded in it.
  - `unreachable` — the popup became unreachable within ~1.5 s of navigating to checkout. That is
    almost always this page's `Cross-Origin-Opener-Policy: same-origin` (see
    [Constraints](#constraints)); **checkout may still be open and the payer may still pay**.
    `openCheckout` logs a `console.warn` naming the fix once. Tell the payer to check their order
    status rather than start another checkout straight away.
  - `superseded` — a newer `openCheckout()` call took over the popup.
  - `returned_from_redirect` — the page was sent to checkout (popup blocked, or
    `redirectToCheckout`) and the payer came back through the back/forward cache.

### Constraints

- **Results only arrive when the page that called `openCheckout` is on the origin of the
  session's `success_url`.** The checkout page posts its result to that origin specifically; on
  any other origin nothing is delivered and the call resolves `closed` once the payer closes the
  popup.
- **`Cross-Origin-Opener-Policy: same-origin` on your page severs the popup** as soon as it
  navigates to checkout: this page sees it as closed at once (`closed`, `reason: 'unreachable'`)
  while the payer is still paying in it, and no result ever arrives — the page must send
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` instead (never plain `same-origin`), or
  omit the header entirely (the browser default is unset, which also works). If your framework
  or a security middleware sets it for you — [`helmet`](https://helmetjs.github.io/), which
  defaults to `same-origin`, is the common case on an Express app — override it on the page (or
  route) that calls `openCheckout` / renders `<fianto-button>`:

  ```ts no-check
  import helmet from 'helmet';

  app.use(helmet()); // defaults to COOP: same-origin — fine for the rest of the app
  app.get('/checkout-page', helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }), (req, res) => {
    /* render the page that calls openCheckout() / renders <fianto-button> */
  });
  ```
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
import '@fianto/js/button'; // registers <fianto-button> and its HTMLElementTagNameMap entry

declare const orderId: string;
declare function createCheckoutSession(orderId: string): Promise<{ id: string; url: string }>;

document.querySelector('fianto-button')!.session = () => createCheckoutSession(orderId);
```

Events (bubbling, composed — listen at any ancestor): `fianto:result` (`detail: { status,
session_id }`, plus `reason` when `closed` — the same result as `openCheckout`; read
[Money safety](#the-four-statuses-money-safety) above before acting on `succeeded`),
`fianto:error` (`detail: { code, message }`, `message` being your route's text for you).

`session-endpoint` is called with `fetchCheckoutSession`, and the payer sees a short, localised
line chosen by the error's `code` — never your route's `message`, which can name your own
params: `payment_in_progress` → "A payment for this order is already in progress.",
`order_already_paid` → "This order has already been paid.", `rate_limited` /
`checkout_unavailable` / `session_not_reissuable` / `subscription_preparing` → "Checkout is busy
right now. Please try again shortly.", anything else → "Checkout could not be started. Please try
again." On a `closed` result with `reason: 'unreachable'` it shows "Lost track of the checkout
window. Check your order status before trying again." and ignores clicks for 6 s, rather than
re-enabling straight into a second checkout. Clicking the button while a checkout is open brings
its popup to the front.

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
`session-endpoint` when both are set. It may be set before the element is defined (e.g. before
the CDN script loads): the element picks it up when it upgrades.

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
- A two-tone focus ring on keyboard focus — a 2px white inner ring and a 2px
  `--fianto-button-focus-ring` (default fianto blue) outer one — so one of the two reaches ≥ 3:1
  on light and dark page backgrounds alike. The `dark` theme (and `auto` in dark mode) carries a
  1px edge that stays visible on a dark page.
- The status line under the button is a polite live region that stays in the accessibility tree
  while empty (visually hidden, never `display: none`), so its messages are announced.
- `aria-busy="true"` plus a spinner from click until the popup resolves; the accessible name is
  unaffected by the loading state.
- Leave clear space of at least `height / 10` around the button (e.g. ~4.4px at the default
  44px height) — like the CSS custom properties, this is the host page's responsibility; the
  button does not reserve margin for itself.

## Browser support and bundle size

Any browser with Custom Elements v1, Shadow DOM and ES2020 syntax support — in practice Safari
13.1+, Chrome 80+, Firefox 74+, Edge 80+. `<fianto-button>` and `openCheckout` need
`customElements`/`attachShadow` and `fetch`; `ResizeObserver` (the overflow fallback that
shrinks a too-wide label to the logo-only layout) is feature-detected and simply skipped where
it's absent, not a hard requirement. The CDN IIFE bundle (`fianto-button.global.iife.js`) is
built for ES2020 specifically, with no polyfills, and deliberately avoids anything newer (e.g.
`Object.hasOwn`, which would otherwise break Safari < 15.4).

Brotli-compressed, minified sizes (enforced in CI, `.size-limit.json` at the repo root):
`@fianto/js`'s core `{ openCheckout }` import is under 4 kB, `@fianto/js/button` (the custom
element) under 8 kB, and the CDN bundle under 10 kB.

## Troubleshooting

- **`fianto:result` never fires; the popup just closes** — you're listening on a different
  origin than the session's `success_url`. Results only post to that origin (see
  [Constraints](#constraints)).
- **`closed` arrives within a second, while the popup is still showing checkout** (`reason:
  'unreachable'`, plus a `console.warn`) — the page that called `openCheckout`/clicked the button
  sends `Cross-Origin-Opener-Policy: same-origin`, which severs the popup. Send
  `same-origin-allow-popups` instead.
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
