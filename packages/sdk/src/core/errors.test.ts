import {
  APIError, AuthenticationError, ConflictError, FiantoError, InternalServerError,
  InvalidRequestError, NotFoundError, PermissionDeniedError, RateLimitError,
  ServiceUnavailableError, errorFromResponse, isFiantoError, parseRetryAfter,
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
