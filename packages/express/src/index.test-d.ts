// Type-level checks only — compiled by `tsc -p tsconfig.json` (`pnpm typecheck`), never run by
// vitest (see @fianto/sdk's `core/errors.test-d.ts` for why).
//
// F11: createSession receives Express's own req/res, typed.
import type { Request, Response } from 'express';
import { expectTypeOf } from 'vitest';
import { checkout, type ExpressContext } from './index.js';

checkout({
  createSession: async (_request, context) => {
    expectTypeOf(context).toEqualTypeOf<ExpressContext>();
    expectTypeOf(context.req).toEqualTypeOf<Request>();
    expectTypeOf(context.res).toEqualTypeOf<Response>();
    return new globalThis.Response(null, { status: 204 });
  },
});
