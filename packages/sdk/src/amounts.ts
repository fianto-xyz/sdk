import { FiantoError } from './core/errors.js';

const DECIMALS = 6;
const SCALE = 10n ** BigInt(DECIMALS);
const USDC_DECIMAL = /^\d+(\.\d{1,6})?$/;
/**
 * USD is a two-decimal currency: "Currencies are two-decimal currencies unless otherwise
 * specified", and "enter 1099 to charge 10.99 USD (or any other two-decimal currency)"
 * (https://docs.stripe.com/currencies.md, checked 2026-11-13). fianto still states USD amounts
 * in the same 6-decimal base units as USDC.
 */
const USD_DECIMAL = /^\d+(\.\d{1,2})?$/;
const BASE = /^\d+$/;

/**
 * `usd`/`usdc`/`money` reject anything that is not a valid amount. `code` is `invalid_amount`,
 * or `invalid_usdc_amount` for the USDC helpers (`UsdcError`, a subclass), so
 * `instanceof AmountError` catches both.
 */
export class AmountError extends FiantoError {
  override name = 'AmountError';
  readonly code: 'invalid_amount' | 'invalid_usdc_amount' = 'invalid_amount';
}

/** `usdc.toBaseUnits`/`fromBaseUnits`/`format` reject anything that is not a valid USDC amount. */
export class UsdcError extends AmountError {
  override name = 'UsdcError';
  override readonly code = 'invalid_usdc_amount';
}

type Refuse = (message: string) => AmountError;

function toBigInt(base: string | bigint, refuse: Refuse, unit: string): bigint {
  if (typeof base === 'bigint') {
    if (base < 0n) throw refuse(`Not ${unit} base units: ${base}`);
    return base;
  }
  if (!BASE.test(base)) throw refuse(`Not ${unit} base units: ${JSON.stringify(base)}`);
  return BigInt(base);
}

function toBaseUnits(decimal: string): string {
  const [whole = '0', fraction = ''] = decimal.split('.');
  return (BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMALS, '0'))).toString();
}

function fromBaseUnits(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** At least two decimals ("25.00"); every further digit is kept ("12.345678"), never rounded. */
function twoDecimals(decimal: string): string {
  const [whole, fraction = ''] = decimal.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

const usdcError: Refuse = (message) => new UsdcError(message);
const amountError: Refuse = (message) => new AmountError(message);

/**
 * USDC has 6 decimals. The API takes amounts as decimal strings ("12.5") and returns them as
 * base-unit integer strings ("12500000"). Strings and bigints only: never floats.
 */
export const usdc = {
  toBaseUnits(decimal: string): string {
    if (!USDC_DECIMAL.test(decimal)) {
      throw new UsdcError(`Not a USDC amount (up to 6 decimals, no sign): ${JSON.stringify(decimal)}`);
    }
    return toBaseUnits(decimal);
  },

  fromBaseUnits(base: string | bigint): string {
    return fromBaseUnits(toBigInt(base, usdcError, 'USDC'));
  },

  /** "12.50 USDC"; `{ symbol: false }` gives "12.50". */
  format(base: string | bigint, options: { symbol?: boolean } = {}): string {
    const text = twoDecimals(usdc.fromBaseUnits(base));
    return options.symbol === false ? text : `${text} USDC`;
  },
};

/**
 * US dollars, for card payments (`currency: 'USD'`). fianto states them in the same 6-decimal
 * base units as USDC ("25000000" is $25.00). Strings and bigints only: never floats.
 */
export const usd = {
  /** "10.5" → "10500000". At most 2 decimals (USD is two-decimal), no sign. */
  toBaseUnits(decimal: string): string {
    if (!USD_DECIMAL.test(decimal)) {
      throw new AmountError(`Not a USD amount (up to 2 decimals, no sign): ${JSON.stringify(decimal)}`);
    }
    return toBaseUnits(decimal);
  },

  /** "10500000" → "10.5", the shortest decimal. */
  fromBaseUnits(base: string | bigint): string {
    return fromBaseUnits(toBigInt(base, amountError, 'USD'));
  },

  /** "$25.00" for whole cents; any further digit is kept ("$12.345678"). `{ symbol: false }` drops the "$". */
  format(base: string | bigint, options: { symbol?: boolean } = {}): string {
    const text = twoDecimals(usd.fromBaseUnits(base));
    return options.symbol === false ? text : `$${text}`;
  },
};

/** Display helpers that pick the right format from a payload's own `currency`. */
export const money = {
  /**
   * Formats base units in the `currency` a payment, order, session or subscription carries:
   * `'USDC'` → "25.00 USDC" (as `usdc.format`), `'USD'` → "$25.00" (as `usd.format`).
   * Throws `AmountError` (`invalid_amount`) for any other currency, and the same errors as
   * `usdc.format`/`usd.format` for bad base units.
   */
  format(base: string | bigint, currency: string): string {
    if (currency === 'USDC') return usdc.format(base);
    if (currency === 'USD') return usd.format(base);
    throw new AmountError(`Not a currency this SDK formats (USDC or USD): ${JSON.stringify(currency)}`);
  },
};
