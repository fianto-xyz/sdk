// Type-level checks only (see `core/errors.test-d.ts` for why this is a `*.test-d.ts` file).
import { expectTypeOf } from 'vitest';
import { money } from './amounts.js';
import type { Currency, Payment } from './types.js';

declare const payment: Payment;
declare const fromDb: string;

// `Currency` autocompletes the two values the SDK formats, yet still takes any string (a value
// read back from your own database); an unknown one throws AmountError at runtime.
expectTypeOf<'USDC'>().toExtend<Currency>();
expectTypeOf<'USD'>().toExtend<Currency>();
expectTypeOf<string>().toExtend<Currency>();
expectTypeOf(money.format).parameter(1).toEqualTypeOf<Currency>();
expectTypeOf(money.format).parameter(2).toEqualTypeOf<{ symbol?: boolean } | undefined>();
money.format(payment.total_amount, payment.currency);
money.format(payment.total_amount, fromDb, { symbol: false });
// @ts-expect-error amounts are base-unit strings or bigints, never numbers
money.format(25, 'USD');
