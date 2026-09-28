// Type-level checks only — see `../types.test-d.ts` / `../core/errors.test-d.ts` for why this is
// a `*.test-d.ts` file, not a `*.test.ts`: picked up by `tsc -p tsconfig.json` (`pnpm
// typecheck`), not vitest's runner.
//
// `CheckoutSessionParams` is `DistributiveOmit<CheckoutSessionCreateParams, 'ui_mode'>` (see
// checkout.ts) instead of the ordinary, non-distributive `Omit`, specifically because the plain
// `Omit` collapses CheckoutSessionCreateParams's price_id/amount+description union into one
// object type where both branches go optional — silently losing the mutual exclusivity A1 added
// one file away. This is the adapters' side of `../types.test-d.ts`'s item-1 checks:
// `CheckoutSessionParams` is what `createCheckoutHandler`'s `createSession` callback must
// return, and every adapter (`@fianto/nextjs`'s `Checkout`, `@fianto/hono`'s `checkout`,
// `@fianto/express`'s `checkout`) re-exports that same callback shape unchanged.
import { expectTypeOf } from 'vitest';
import { createCheckoutHandler, type CheckoutSessionParams } from './checkout.js';

const priceOnly: CheckoutSessionParams = {
  price_id: 'fian_price_1', mode: 'subscription', order_id: 'o-1',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
void priceOnly;

const amountWithDescription: CheckoutSessionParams = {
  amount: '10.00', description: 'Coffee', mode: 'payment', order_id: 'o-1',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
void amountWithDescription;

// @ts-expect-error an amount checkout without `description` must not type-check (A1, via DistributiveOmit).
const amountWithoutDescription: CheckoutSessionParams = {
  amount: '10.00', mode: 'payment', order_id: 'o-1',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
void amountWithoutDescription;

// @ts-expect-error price_id and amount are mutually exclusive (A1, via DistributiveOmit).
const priceIdAndAmount: CheckoutSessionParams = {
  price_id: 'fian_price_1', amount: '10.00', description: 'Coffee', mode: 'payment', order_id: 'o-1',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
};
void priceIdAndAmount;

// Excess-property checks report on the offending property's own line, not the declaration's —
// unlike the two checks above (a union-membership mismatch, reported on the declaration line) —
// so the directive has to sit directly above `ui_mode:` itself, as a single line, to line up.
const withUiMode: CheckoutSessionParams = {
  price_id: 'fian_price_1', mode: 'subscription', order_id: 'o-1',
  success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/no',
  // @ts-expect-error ui_mode is dropped from CheckoutSessionParams (createCheckoutHandler sets it itself).
  ui_mode: 'popup',
};
void withUiMode;

// --- F11: an adapter's framework context reaches createSession, typed ------------------------
// The generic layer stays framework-agnostic: the context type is a type parameter (default
// `unknown`), and the returned handler takes it as its second argument — optional only while
// `undefined` fits the context type, so an adapter with a real context must always pass it.
declare const request: Request;

const typed = createCheckoutHandler<{ userId: string }>({
  createSession: async (_request, context) => {
    expectTypeOf(context).toEqualTypeOf<{ userId: string }>();
    return new Response(null, { status: 204 });
  },
});
void typed(request, { userId: 'u_1' });
// @ts-expect-error a typed context must be passed.
void typed(request);
// @ts-expect-error and must have the declared shape.
void typed(request, { user: 'u_1' });

const untyped = createCheckoutHandler({
  createSession: async (_request, context) => {
    expectTypeOf(context).toEqualTypeOf<unknown>();
    return new Response(null, { status: 204 });
  },
});
void untyped(request);
void untyped(request, { anything: true });
