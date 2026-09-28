import { FiantoError } from './errors.js';

/**
 * Several write methods (`checkoutSessions.cancel`/`reissueLink`, `webhookEndpoint.sendTestEvent`)
 * take a reserved `params` slot that is empty today, so a future body field is additive instead
 * of a signature change (F6). Forwarding it unconditionally would send an empty `{}` body (and
 * its `content-type` header) where none was sent before; this keeps that wire behaviour
 * unchanged until the slot's type actually gains a field.
 */
export function bodyOf<T extends object>(params: T): T | undefined {
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * `RequestOptions`' own keys (kept as a literal list, not imported from `./transport.js`, so
 * this has no import cycle with it).
 */
const REQUEST_OPTION_KEYS = new Set(['idempotencyKey', 'timeoutMs', 'signal', 'maxRetries']);

/**
 * Every resource method takes `params` and `options` (`RequestOptions`) as separate positional
 * arguments — `resource.retrieve(id, params?, options?)`. A caller (especially plain JS, with no
 * compiler to catch it) who means to pass `options` but puts it in the `params` slot instead
 * gets silently misused: `idempotencyKey`/`timeoutMs`/`signal`/`maxRetries` end up spread into a
 * query string or an empty body instead of controlling the request. Call this first in every
 * method that takes both slots, so the mistake throws instead of misbehaving.
 */
export function assertNotRequestOptions(params: object, method: string): void {
  const found = Object.keys(params).find((key) => REQUEST_OPTION_KEYS.has(key));
  if (found === undefined) return;
  throw new FiantoError(
    `${method}(): "${found}" looks like a request option (idempotencyKey, timeoutMs, signal, ` +
      `maxRetries), but it was passed in the params argument. Pass request options as the LAST ` +
      `argument instead, e.g. ${method}(..., { ${found}: ... }).`,
  );
}
