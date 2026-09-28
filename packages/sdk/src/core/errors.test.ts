import {
  AbortError, APIError, AuthenticationError, ConflictError, ConnectionError, FiantoError, InternalServerError,
  InvalidRequestError, NotFoundError, PermissionDeniedError, RateLimitError,
  ServiceUnavailableError, errorFromResponse, isAPIError, isFiantoError, parseRetryAfter,
} from './errors.js';

const body = (code: string, extra: Record<string, unknown> = {}) => ({
  statusCode: 0, error: 'X', code, message: `msg ${code}`, request_id: 'req_abcdefgh', ...extra,
});

it.each([
  [400, InvalidRequestError], [401, AuthenticationError], [403, PermissionDeniedError],
  [404, NotFoundError], [409, ConflictError], [422, InvalidRequestError], [429, RateLimitError],
  [500, InternalServerError], [502, InternalServerError], [503, ServiceUnavailableError],
])('maps %i to its class', (status, Class) => {
  const error = errorFromResponse(status, body('some_code'), new Headers());
  expect(error).toBeInstanceOf(Class);
  expect(error).toBeInstanceOf(APIError);
  expect(error).toBeInstanceOf(FiantoError);
  expect(error.status).toBe(status);
});

it('carries every field of the error body', () => {
  const error = errorFromResponse(
    400,
    body('validation_failed', { field: 'amount', details: ['amount must be a string'] }),
    new Headers({ 'x-request-id': 'req_header1' }),
  );
  expect(error).toMatchObject({
    code: 'validation_failed', message: 'msg validation_failed', field: 'amount',
    details: ['amount must be a string'], requestId: 'req_abcdefgh',
  });
});

it('falls back to the X-Request-Id header and an unknown code for a non-JSON body', () => {
  const error = errorFromResponse(502, '<html>bad gateway</html>', new Headers({ 'x-request-id': 'req_header1' }));
  expect(error.code).toBe('unknown');
  expect(error.requestId).toBe('req_header1');
  expect(error.message).toContain('502');
});

it('reads Retry-After on a rate limit', () => {
  const error = errorFromResponse(429, body('rate_limited'), new Headers({ 'retry-after': '7' }));
  expect((error as RateLimitError).retryAfterSeconds).toBe(7);
});

it('parses Retry-After seconds and HTTP dates', () => {
  expect(parseRetryAfter('5')).toBe(5);
  expect(parseRetryAfter(null)).toBeUndefined();
  expect(parseRetryAfter('soon')).toBeUndefined();
  const now = Date.parse('2026-09-28T10:00:00Z');
  expect(parseRetryAfter('Mon, 28 Sep 2026 10:00:30 GMT', now)).toBe(30);
});

it('narrows by code', () => {
  const error: unknown = errorFromResponse(409, body('payment_in_progress'), new Headers());
  expect(isFiantoError(error)).toBe(true);
  expect(isFiantoError(error, 'payment_in_progress')).toBe(true);
  expect(isFiantoError(error, 'order_already_paid')).toBe(false);
  expect(isFiantoError(new Error('x'))).toBe(false);
});

it('narrows a non-API FiantoError by its own stable code too', () => {
  const abort: unknown = new AbortError(new Error('cancel'));
  expect(isFiantoError(abort, 'aborted')).toBe(true);
  expect(isFiantoError(abort, 'timeout')).toBe(false);
});

it('isAPIError picks out the HTTP-response family, not every FiantoError', () => {
  const api = errorFromResponse(500, body('internal_error'), new Headers());
  expect(isAPIError(api)).toBe(true);
  expect(isAPIError(new ConnectionError('down'))).toBe(false);
  expect(isAPIError(new AbortError())).toBe(false);
  expect(isAPIError(new Error('x'))).toBe(false);
  expect(isAPIError(null)).toBe(false);
});

it('AbortError carries the abort reason as cause and a stable code', () => {
  const reason = new Error('user cancelled');
  const error = new AbortError(reason);
  expect(error).toBeInstanceOf(FiantoError);
  expect(error.code).toBe('aborted');
  expect(error.cause).toBe(reason);
});

// F4/B8: `instanceof FiantoError` must recognise an error minted by a *different* copy of this
// module (simulated here by an object with the same brand but a foreign prototype), the way a
// dual ESM/CJS install or two versions in a monorepo would produce one.
it('instanceof FiantoError recognises a brand from a different copy of this module', () => {
  class OtherCopyError extends Error {}
  const foreign = Object.assign(new OtherCopyError('from another copy'), { [Symbol.for('fianto.error')]: true });
  expect(foreign instanceof FiantoError).toBe(true);
  expect(isFiantoError(foreign)).toBe(true);
  expect(foreign instanceof OtherCopyError).toBe(true);
});

it('a tagged non-Error is never mistaken for a FiantoError', () => {
  const notAnError = { [Symbol.for('fianto.error')]: true };
  expect(notAnError instanceof FiantoError).toBe(false);
  expect(isFiantoError(notAnError)).toBe(false);
});

it('instanceof on a specific subclass still uses the ordinary prototype chain', () => {
  const api = errorFromResponse(429, body('rate_limited'), new Headers());
  expect(api).toBeInstanceOf(RateLimitError);
  expect(api).not.toBeInstanceOf(InvalidRequestError);
  expect(new ConnectionError('down')).not.toBeInstanceOf(RateLimitError);
});
