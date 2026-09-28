// Type-level checks only — compiled by `tsc -p tsconfig.json` (`pnpm typecheck`), never run by
// vitest (see @fianto/sdk's `core/errors.test-d.ts` for why).
//
// F11: createSession receives the Hono Context, typed by the app's Env when one is given.
import { Hono, type Context } from 'hono';
import { expectTypeOf } from 'vitest';
import { checkout } from './index.js';

type AppEnv = { Bindings: { SHOP: string } };

new Hono<AppEnv>().post('/checkout', checkout<AppEnv>({
  createSession: async (_request, c) => {
    expectTypeOf(c).toEqualTypeOf<Context<AppEnv>>();
    expectTypeOf(c.env.SHOP).toEqualTypeOf<string>();
    return new Response(null, { status: 204 });
  },
}));

new Hono().post('/checkout', checkout({
  createSession: async (_request, c) => {
    expectTypeOf(c).toEqualTypeOf<Context>();
    return new Response(null, { status: 204 });
  },
}));
