import { FiantoError } from './core/errors.js';
import { AmountError, money, usd, usdc, UsdcError } from './amounts.js';

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

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

it('makes UsdcError an AmountError that keeps its own code', () => {
  const error = thrown(() => usdc.format('-1'));
  expect(error).toBeInstanceOf(UsdcError);
  expect(error).toBeInstanceOf(AmountError);
  expect(error).toBeInstanceOf(FiantoError);
  expect((error as UsdcError).code).toBe('invalid_usdc_amount');
  expect((error as UsdcError).name).toBe('UsdcError');
});

describe('formats per currency', () => {
  it('shows US dollars with a $ and two decimals for whole cents', () => {
    expect(money.format('25000000', 'USD')).toBe('$25.00');
    expect(usd.format('25000000')).toBe('$25.00');
    expect(usd.format('12340000')).toBe('$12.34');
    expect(usd.format('12300000')).toBe('$12.30');
    expect(usd.format(0n)).toBe('$0.00');
    expect(usd.format('25000000', { symbol: false })).toBe('25.00');
  });

  it('shows every digit when the amount is not whole cents', () => {
    expect(usd.format('12345678')).toBe('$12.345678');
    expect(usd.format('1')).toBe('$0.000001');
  });

  it('shows USDC as usdc.format does', () => {
    expect(money.format('25000000', 'USDC')).toBe('25.00 USDC');
    const samples = [
      '0', '1', '9', '10', '99', '100', '9999', '10000', '12345', '500000',
      '1000000', '1230000', '12345678', '25000000', '99999999', '100000000', '999999990000', '1000000000000',
      '123456789012345678', '18446744073709551615',
    ];
    expect(samples).toHaveLength(20);
    for (const sample of samples) expect(money.format(sample, 'USDC')).toBe(usdc.format(sample));
    expect(money.format(25000000n, 'USDC')).toBe(usdc.format(25000000n));
  });

  it.each(['-1', '1.5', '', 'abc', ' 1'])('rejects USD base units %j with invalid_amount', (value) => {
    const error = thrown(() => usd.format(value));
    expect(error).toBeInstanceOf(AmountError);
    expect(error).not.toBeInstanceOf(UsdcError);
    expect((error as AmountError).code).toBe('invalid_amount');
    expect(thrown(() => money.format(value, 'USD'))).toMatchObject({ code: 'invalid_amount' });
  });

  it('rejects a negative bigint for USD', () => {
    expect(thrown(() => usd.format(-1n))).toMatchObject({ code: 'invalid_amount' });
  });

  it('still throws UsdcError for bad USDC base units', () => {
    const error = thrown(() => money.format('-1', 'USDC'));
    expect(error).toBeInstanceOf(UsdcError);
    expect((error as UsdcError).code).toBe('invalid_usdc_amount');
  });

  it.each(['EUR', 'usd', 'usdc', '', 'SOL'])('throws invalid_amount for a currency the SDK does not know: %j', (currency) => {
    const error = thrown(() => money.format('1', currency));
    expect(error).toBeInstanceOf(AmountError);
    expect((error as AmountError).code).toBe('invalid_amount');
    expect((error as AmountError).message).toContain(JSON.stringify(currency));
  });
});

describe('converts US dollars', () => {
  it('turns at most two decimals into 6-decimal base units', () => {
    expect(usd.toBaseUnits('10')).toBe('10000000');
    expect(usd.toBaseUnits('10.5')).toBe('10500000');
    expect(usd.toBaseUnits('10.50')).toBe('10500000');
    expect(usd.toBaseUnits('0.50')).toBe('500000');
    expect(usd.toBaseUnits('0')).toBe('0');
    expect(usd.toBaseUnits('999999.99')).toBe('999999990000');
  });

  it.each(['10.505', '-1', '1e2', ' ', '', '1.', '.5', 'abc', '10.5 '])('rejects %j with invalid_amount', (value) => {
    const error = thrown(() => usd.toBaseUnits(value));
    expect(error).toBeInstanceOf(AmountError);
    expect(error).not.toBeInstanceOf(UsdcError);
    expect((error as AmountError).code).toBe('invalid_amount');
    expect((error as AmountError).message).toMatch(/USD amount/);
  });

  it('turns base units back into the shortest decimal', () => {
    expect(usd.fromBaseUnits('10500000')).toBe('10.5');
    expect(usd.fromBaseUnits(0n)).toBe('0');
    expect(usd.fromBaseUnits('12345678')).toBe('12.345678');
    expect(thrown(() => usd.fromBaseUnits('-5'))).toMatchObject({ code: 'invalid_amount' });
  });

  it('round-trips every two-decimal amount through base units', () => {
    for (const decimal of ['0.01', '0.1', '1', '19.99', '250', '999999.99']) {
      expect(usd.fromBaseUnits(usd.toBaseUnits(decimal))).toBe(decimal);
    }
  });
});
