# @fianto/react

React bindings for [fianto](https://fianto.xyz): the `useCheckout` hook and the branded
`<FiantoButton>` component, built on [`@fianto/js`](https://github.com/fianto-xyz/sdk/tree/master/packages/js#readme).

```bash
pnpm add @fianto/react
```

Peer dependency: `react >= 19`. No provider to set up — there is no publishable key to
configure, and nothing here touches `window` until you call `open()` or click the button.

## `<FiantoButton>`

A Next.js App Router client component (`app/checkout-button.tsx`):

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
      onError={(error) => console.error(error)}
    />
  );
}
```

paired with a route built from `@fianto/sdk` (`app/api/checkout/route.ts`, using
`@fianto/nextjs`'s `Checkout()`):

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

`FiantoButton` renders native React markup from the same shared module `<fianto-button>` uses —
not the custom element — so there is no hydration flash in Next.js: the server and the client
render the same DOM.

`fetchCheckoutSession` (re-exported from `@fianto/js`, with its errors `FiantoCheckoutError`,
`CheckoutSessionError`, `InvalidSessionError` and `PopupBlockedError`) `POST`s its
`body` as JSON to your route and rejects with a `CheckoutSessionError` carrying the route's
`code` (`payment_in_progress`, `order_session_mismatch`, `rate_limited`, …), `status` and
`retryAfter` — see [`@fianto/js`](https://github.com/fianto-xyz/sdk/tree/master/packages/js#fetchcheckoutsession).
The button shows the payer a short localised line chosen by that `code`, never the route's own
`message` (written for you; it reaches `onError`). On a `closed` result with `reason:
'unreachable'` (the popup was cut off, usually by `Cross-Origin-Opener-Policy: same-origin`) it
shows "Lost track of the checkout window. Check your order status before trying again." and
ignores clicks for 6 s. Clicking it while a checkout is open brings the popup to the front.

### Props

| Prop | Type | Default |
|---|---|---|
| `session` | `{ id, url } \| () => Promise<{ id, url }>` (required) | — |
| `theme` | `'brand' \| 'dark' \| 'light' \| 'outline' \| 'auto'` | `'brand'` |
| `label` | `'plain' \| 'pay' \| 'buy' \| 'checkout' \| 'subscribe' \| 'donate'` | `'pay'` |
| `shape` | `'rect' \| 'rounded' \| 'pill'` | `'rounded'` |
| `size` | `'static' \| 'fill'` | `'static'` |
| `locale` | `'en' \| 'vi'` | see [SSR note](#ssr-note) below |
| `fallback` | `'redirect' \| 'none'` | `'redirect'` |
| `loading` | `boolean` — forces the spinner/`aria-busy` state on, in addition to the state `useCheckout` already tracks internally while a checkout is open | `false` |
| `disabled` | `boolean` | `false` |
| `onResult` | `(result: CheckoutResult) => void` | — |
| `onError` | `(error: Error) => void` | — |
| `className` | `string` | — |
| `style` | `React.CSSProperties` | — |

`ref` forwards to the underlying `<button>` element.

### SSR note

`locale` resolves only from the explicit prop during render, never from `navigator` — the
server has no `navigator`, and guessing from a client-only value would make the server- and
client-rendered markup disagree and trip React's hydration check. If the server and client must
render the **exact same locale** (e.g. you localize the whole page server-side), pass `locale`
explicitly. Left unset, the button renders with `en` on the server and, once mounted, an effect
reads `navigator.language` and re-renders in the visitor's language — so an English flash before
a non-English visitor's locale kicks in is expected, not a bug.

## `useCheckout`

For a custom button or flow that isn't `<FiantoButton>`'s markup:

```tsx
'use client';

import { fetchCheckoutSession, useCheckout } from '@fianto/react';

export function CheckoutButton({ orderId }: { orderId: string }) {
  const { open, focus, isOpen } = useCheckout({
    session: () => fetchCheckoutSession('/api/checkout', { body: { orderId } }),
  });

  return (
    // While a checkout is open, a click brings its popup back instead of starting another.
    <button onClick={() => (isOpen ? focus() : void open())} aria-busy={isOpen}>
      {isOpen ? 'Checkout open…' : 'Pay'}
    </button>
  );
}
```

`open()` must be called synchronously from an event handler — it calls `openCheckout` before any
`await`, so the popup blocker still treats it as a direct response to the click. It never
throws: on failure it sets `error`/`status: 'error'` and resolves `undefined`, so you can always
`await open()` without a `try`/`catch`.

Only the latest `open()` drives the state: calling it again supersedes the checkout in progress
(whose promise resolves `closed` with `reason: 'superseded'`), and the hook stays `open` until the
newer one settles.

`useCheckout({ session, fallback? }) → { open, focus, status, result, error, isOpen }`:

| Field | Type |
|---|---|
| `open` | `() => Promise<CheckoutResult \| undefined>` |
| `focus` | `() => boolean` — brings the open checkout popup to the front; `false` if there is none |
| `status` | `'idle' \| 'open' \| 'done' \| 'error'` |
| `result` | `CheckoutResult \| null` — `{ status, session_id }`, plus `reason` when `closed` |
| `error` | `Error \| null` — a `CheckoutSessionError` (with `code`) when your route refused |
| `isOpen` | `boolean` — `status === 'open'` |

## `'use client'`

Every file this package ships starts with a `'use client'` directive, so `FiantoButton` and
`useCheckout` can be imported directly from a React Server Component module — the import itself
is fine on the server; only rendering `<FiantoButton>` or calling `open()` needs the client.
That's also why the usage examples above mark the component file `'use client'` explicitly: a
component that renders `<FiantoButton>` and wires up `onClick`/`onResult` needs to run on the
client itself, even though importing the package does not.

## Money safety

`result.status` is one of the same four values `openCheckout` in `@fianto/js` returns:
`succeeded` means the payer's transaction was confirmed **on the checkout page** — not that the
order settled. Fulfil an order only from a verified `order.paid` webhook or a server-side
`fianto.orders.retrieve(id)` call, both documented in `@fianto/sdk`'s README, never from this
value alone. `closed` means **unknown** — no result reached you; its `reason`
(`closed_by_payer`, `unreachable`, `superseded`, `returned_from_redirect`) says why — never tell
them "nothing was charged" on that status. On `unreachable` the checkout may still be open: tell
the payer to check their order status rather than start another checkout.

## License

MIT
