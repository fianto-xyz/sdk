import { readFileSync } from 'node:fs';
import { ErrorCode } from './error-codes.js';

const spec = JSON.parse(readFileSync(new URL('../../../../spec/openapi.json', import.meta.url), 'utf8'));

it('lists every documented error code', () => {
  const schema = spec.components.schemas.Error.properties.code;
  const known: string[] = (schema.anyOf ?? [schema]).find((s: { enum?: string[] }) => s.enum).enum;
  expect(Object.values(ErrorCode).sort()).toEqual([...known].sort());
  expect(ErrorCode.PaymentInProgress).toBe('payment_in_progress');
});

it('has types for every operation in the spec', () => {
  const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
  for (const ops of Object.values(spec.paths) as Record<string, { operationId: string }>[]) {
    for (const op of Object.values(ops)) expect(api).toContain(`"${op.operationId}"`);
  }
});
