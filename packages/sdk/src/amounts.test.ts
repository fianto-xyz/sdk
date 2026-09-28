import { FiantoError } from './core/errors.js';
import { usdc, UsdcError } from './amounts.js';

it('converts decimals to base units', () => {
  expect(usdc.toBaseUnits('12.5')).toBe('12500000');
  expect(usdc.toBaseUnits('0.000001')).toBe('1');
  expect(usdc.toBaseUnits('1000000')).toBe('1000000000000');
  expect(usdc.toBaseUnits('0')).toBe('0');
});

it.each(['', '-1', '1.2345678', 'abc', '1e3', ' 1', '1.', '.5'])('rejects %j', (value) => {
  expect(() => usdc.toBaseUnits(value)).toThrow(/USDC amount/);
});

it('rejects with a stable, branded error code', () => {
  expect(() => usdc.toBaseUnits('abc')).toThrow(UsdcError);
  expect(() => usdc.toBaseUnits('abc')).toThrow(FiantoError);
  try {
    usdc.toBaseUnits('abc');
  } catch (error) {
    expect((error as UsdcError).code).toBe('invalid_usdc_amount');
  }
});

it('converts base units to the shortest decimal', () => {
  expect(usdc.fromBaseUnits('12500000')).toBe('12.5');
  expect(usdc.fromBaseUnits(1n)).toBe('0.000001');
  expect(usdc.fromBaseUnits('10000000')).toBe('10');
  expect(() => usdc.fromBaseUnits('-5')).toThrow(/base units/);
  expect(() => usdc.fromBaseUnits('-5')).toThrow(UsdcError);
});

it('formats with at least two decimals', () => {
  expect(usdc.format('12500000')).toBe('12.50 USDC');
  expect(usdc.format('1')).toBe('0.000001 USDC');
  expect(usdc.format('10000000', { symbol: false })).toBe('10.00');
});
