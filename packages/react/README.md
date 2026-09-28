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

import { FiantoButton } from '@fianto/react';

export function CheckoutButton({ orderId }: { orderId: string }) {
  return (
    <FiantoButton
      session={() =>
        fetch('/api/checkout', { method: 'POST', body: JSON.stringify({ orderId }) }).then((r) => r.json())
      }
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

import { useCheckout } from '@fianto/react';

export function CheckoutButton({ orderId }: { orderId: string }) {
  const { open, status, result, error } = useCheckout({
    session: () => fetch('/api/checkout', { method: 'POST', body: JSON.stringify({ orderId }) }).then((r) => r.json()),
  });

  return (
    <button onClick={() => void open()} disabled={status === 'open'}>
      {status === 'open' ? 'Opening…' : 'Pay'}
    </button>
  );
}
```

`open()` must be called synchronously from an event handler — it calls `openCheckout` before any
`await`, so the popup blocker still treats it as a direct response to the click. It never
throws: on failure it sets `error`/`status: 'error'` and resolves `undefined`, so you can always
`await open()` without a `try`/`catch`.

`useCheckout({ session, fallback? }) → { open, status, result, error, isOpen }`:

| Field | Type |
|---|---|
| `open` | `() => Promise<CheckoutResult \| undefined>` |
| `status` | `'idle' \| 'open' \| 'done' \| 'error'` |
| `result` | `CheckoutResult \| null` — `{ status, session_id }` |
| `error` | `Error \| null` |
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
value alone. `closed` means **unknown** — the payer closed the popup without a result reaching
you — never tell them "nothing was charged" on that status.

## License

MIT
