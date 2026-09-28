const DECIMALS = 6;
const SCALE = 10n ** BigInt(DECIMALS);
const DECIMAL = /^\d+(\.\d{1,6})?$/;
const BASE = /^\d+$/;

function toBigInt(base: string | bigint): bigint {
  if (typeof base === 'bigint') {
    if (base < 0n) throw new RangeError(`Not USDC base units: ${base}`);
    return base;
  }
  if (!BASE.test(base)) throw new RangeError(`Not USDC base units: ${JSON.stringify(base)}`);
  return BigInt(base);
}

/**
 * USDC has 6 decimals. The API takes amounts as decimal strings ("12.5") and returns them as
 * base-unit integer strings ("12500000"). Strings and bigints only: never floats.
 */
export const usdc = {
  toBaseUnits(decimal: string): string {
    if (!DECIMAL.test(decimal)) {
      throw new RangeError(`Not a USDC amount (up to 6 decimals, no sign): ${JSON.stringify(decimal)}`);
    }
    const [whole = '0', fraction = ''] = decimal.split('.');
    return (BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMALS, '0'))).toString();
  },

  fromBaseUnits(base: string | bigint): string {
    const value = toBigInt(base);
    const whole = value / SCALE;
    const fraction = (value % SCALE).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  },

  format(base: string | bigint, options: { symbol?: boolean } = {}): string {
    const [whole, fraction = ''] = usdc.fromBaseUnits(base).split('.');
    const text = `${whole}.${fraction.padEnd(2, '0')}`;
    return options.symbol === false ? text : `${text} USDC`;
  },
};
