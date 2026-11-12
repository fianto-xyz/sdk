// Type-level checks only — no runtime assertions, nothing here executes. This is NOT a
// `*.test.ts` file (vitest's `test.include` glob and this package's own `tsconfig.json`
// `exclude: ["src/**/*.test.ts"]` both key off that exact suffix), so it is picked up only by
// `tsc -p tsconfig.json` (this package's `pnpm typecheck`), which is what actually proves
// `instanceof`/`isFiantoError` still narrow the way the SDK's own README examples rely on — a
// `*.test.ts` file is never type-checked by `tsc` here, and vitest's own runner strips types
// without checking them, so a check that only lived in a `.test.ts` file would have no teeth.
// Named `*.test-d.ts`, vitest's own convention for type-only tests, so a future `vitest
// typecheck` step (not wired up yet) would pick this up too, for free.
import { expectTypeOf } from 'vitest';
import {
  AbortError, APIError, FiantoError, InvalidRequestError, RateLimitError, TimeoutError, isFiantoError,
} from './errors.js';
import type { AmountError, UsdcError } from '../amounts.js';

declare const unknownError: unknown;

// The static Symbol.hasInstance on FiantoError (added for cross-copy `instanceof FiantoError`)
// must not collapse `instanceof <subclass>` down to `FiantoError` for every subclass.
if (unknownError instanceof RateLimitError) {
  expectTypeOf(unknownError).toEqualTypeOf<RateLimitError>();
  expectTypeOf(unknownError.retryAfterSeconds).toEqualTypeOf<number | undefined>();
}

if (unknownError instanceof APIError) {
  expectTypeOf(unknownError).toEqualTypeOf<APIError>();
  expectTypeOf(unknownError.status).toEqualTypeOf<number>();
}

if (unknownError instanceof InvalidRequestError) {
  expectTypeOf(unknownError).toEqualTypeOf<InvalidRequestError>();
}

if (unknownError instanceof FiantoError) {
  expectTypeOf(unknownError).toEqualTypeOf<FiantoError>();
}

// isFiantoError(x, code): the two non-API stable codes defined in errors.ts narrow to their own
// class; a backend ErrorCode narrows to APIError; any other string narrows only to FiantoError
// (never APIError — `.status` must not be assumed to exist on it).
if (isFiantoError(unknownError, 'aborted')) {
  expectTypeOf(unknownError).toEqualTypeOf<AbortError>();
}

if (isFiantoError(unknownError, 'timeout')) {
  expectTypeOf(unknownError).toEqualTypeOf<TimeoutError>();
}

if (isFiantoError(unknownError, 'payment_in_progress')) {
  expectTypeOf(unknownError).toEqualTypeOf<APIError & { code: 'payment_in_progress' }>();
  expectTypeOf(unknownError.status).toEqualTypeOf<number>();
}

if (isFiantoError(unknownError, 'some_unrecognised_string')) {
  expectTypeOf(unknownError).toEqualTypeOf<FiantoError & { code: 'some_unrecognised_string' }>();
}

// The amount helpers' own codes narrow to their own classes (amounts.ts), not a bare FiantoError.
if (isFiantoError(unknownError, 'invalid_usdc_amount')) {
  expectTypeOf(unknownError).toEqualTypeOf<UsdcError>();
}

if (isFiantoError(unknownError, 'invalid_amount')) {
  expectTypeOf(unknownError).toEqualTypeOf<AmountError & { code: 'invalid_amount' }>();
}

// A UsdcError is an AmountError, so one `instanceof AmountError` catches both helpers' refusals.
expectTypeOf<UsdcError>().toExtend<AmountError>();
expectTypeOf<UsdcError['code']>().toEqualTypeOf<'invalid_usdc_amount'>();
expectTypeOf<AmountError['code']>().toEqualTypeOf<'invalid_amount' | 'invalid_usdc_amount'>();

// payment_method_unavailable is an ordinary APIError: its `method` names the refused method.
if (isFiantoError(unknownError, 'payment_method_unavailable')) {
  expectTypeOf(unknownError).toEqualTypeOf<APIError & { code: 'payment_method_unavailable' }>();
  expectTypeOf(unknownError.method).toEqualTypeOf<string | undefined>();
}
