import { FiantoError } from './errors.js';

const PUBLIC_ID = /^[A-Za-z0-9_]{1,64}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,255}$/;

/** A path segment id, checked before any request so it can never change the URL's path. */
export function pathId(id: string): string {
  if (!PUBLIC_ID.test(id)) throw new FiantoError(`Invalid id ${JSON.stringify(id)}: expected ^[A-Za-z0-9_]{1,64}$.`);
  return id;
}

export function assertIdempotencyKey(key: string): void {
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new FiantoError('Invalid Idempotency-Key: 1–255 printable ASCII characters, no spaces.');
  }
}
