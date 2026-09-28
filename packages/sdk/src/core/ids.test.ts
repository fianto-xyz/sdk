import { FiantoError } from './errors.js';
import { assertIdempotencyKey, pathId } from './ids.js';

it('accepts public ids and rejects anything that could change the path', () => {
  expect(pathId('fian_ord_abc123')).toBe('fian_ord_abc123');
  for (const bad of ['', '../x', 'a/b', 'a b', 'x'.repeat(65), 'évt']) {
    expect(() => pathId(bad)).toThrow(FiantoError);
  }
});

it('validates idempotency keys like the backend does', () => {
  expect(() => assertIdempotencyKey('checkout:order-1:1')).not.toThrow();
  for (const bad of ['', 'has space', 'x'.repeat(256), 'tab\t']) {
    expect(() => assertIdempotencyKey(bad)).toThrow(FiantoError);
  }
});
