// Type-level checks only — compiled by `tsc -p tsconfig.json` (`pnpm typecheck`), never run by
// vitest (see @fianto/sdk's `core/errors.test-d.ts` for why).
//
// F11: `Checkout()`'s POST must still satisfy what Next.js 16's generated route validator
// demands of a route module's POST (copied from next's typegen `RouteHandlerConfig`), for a
// static route and a dynamic one, while createSession sees the route context typed.
import { expectTypeOf } from 'vitest';
import { Checkout, type RouteContext } from './index.js';

interface NextRequestLike extends Request { nextUrl: URL }
type NextPost<Params> = (request: NextRequestLike, context: { params: Promise<Params> }) => Promise<Response | void> | Response | void;

const POST = Checkout({
  createSession: async (_request, context) => {
    expectTypeOf(context).toEqualTypeOf<RouteContext>();
    expectTypeOf(await context.params).toEqualTypeOf<Record<string, string | string[] | undefined>>();
    return new Response(null, { status: 204 });
  },
});
const staticRoute: NextPost<{}> = POST;
const dynamicRoute: NextPost<{ plan: string }> = POST;
const catchAll: NextPost<{ slug?: string[] }> = POST;
void staticRoute;
void dynamicRoute;
void catchAll;
