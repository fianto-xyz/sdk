import { assertNotRequestOptions, bodyOf } from './params.js';
import { FiantoError } from './errors.js';

describe('assertNotRequestOptions', () => {
  it.each(['idempotencyKey', 'timeoutMs', 'signal', 'maxRetries'])(
    'throws a FiantoError when params carries "%s"',
    (key) => {
      expect(() => assertNotRequestOptions({ [key]: 'x' }, 'orders.retrieve')).toThrow(FiantoError);
      expect(() => assertNotRequestOptions({ [key]: 'x' }, 'orders.retrieve')).toThrow(
        new RegExp(`${key}.*orders\\.retrieve`),
      );
    },
  );

  it('names the offending key and the method in the message', () => {
    expect(() => assertNotRequestOptions({ timeoutMs: 5000 }, 'payments.list')).toThrow(/timeoutMs/);
    expect(() => assertNotRequestOptions({ timeoutMs: 5000 }, 'payments.list')).toThrow(/payments\.list/);
  });

  it('does not throw for ordinary params with no RequestOptions keys', () => {
    expect(() => assertNotRequestOptions({}, 'orders.retrieve')).not.toThrow();
    expect(() => assertNotRequestOptions({ status: 'PAID', limit: 10 }, 'orders.list')).not.toThrow();
  });
});

describe('bodyOf', () => {
  it('returns undefined for an empty object and the object itself otherwise', () => {
    expect(bodyOf({})).toBeUndefined();
    expect(bodyOf({ at: 'period_end' })).toEqual({ at: 'period_end' });
  });
});
