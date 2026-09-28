import type { ErrorCode } from '../generated/error-codes.js';

/**
 * A well-known symbol (via `Symbol.for`, the global symbol registry) that every `FiantoError`
 * carries. `isFiantoError`/`isAPIError` check this brand instead of `instanceof` so error
 * detection survives a dual-package install (two copies of `@fianto/sdk` — ESM+CJS, or two
 * versions in a monorepo): `instanceof` fails across copies because each copy has its own
 * `FiantoError` constructor/prototype, but `Symbol.for` always returns the same symbol.
 */
const BRAND = Symbol.for('fianto.error');

function hasBrand(value: unknown): value is FiantoError {
  // `instanceof Error` (the realm-global built-in, not our own `FiantoError`) is what keeps this
  // from mistaking an unrelated tagged object for a real error, while still crossing package copies.
  return value instanceof Error && (value as unknown as Record<PropertyKey, unknown>)[BRAND] === true;
}

/** Base class of every error this SDK throws. */
export class FiantoError extends Error {
  override name = 'FiantoError';
  /** @internal cross-copy brand, see `isFiantoError`. */
  readonly [BRAND] = true;

  /**
   * Makes `x instanceof FiantoError` recognise an instance created by a different copy of this
   * package (see `BRAND`). Subclasses (`APIError`, `RateLimitError`, ...) inherit this static
   * method too, but `this` is bound to whichever class is on the right of `instanceof`, so
   * `x instanceof RateLimitError` still falls through to the ordinary prototype-chain check —
   * only `x instanceof FiantoError` itself gets the brand-based, cross-copy behaviour. Prefer
   * `isFiantoError`/`isAPIError` over `instanceof` for anything that decides behaviour.
   *
   * Generic over `this` (rather than fixed to `FiantoError`) so TypeScript still narrows
   * `x instanceof RateLimitError` to `RateLimitError` (not just `FiantoError`) — a non-generic
   * `instance is FiantoError` predicate here would narrow every subclass check down to the base
   * class, breaking e.g. `if (e instanceof RateLimitError) e.retryAfterSeconds`.
   */
  static [Symbol.hasInstance]<T>(this: abstract new (...args: any[]) => T, instance: unknown): instance is T {
    if ((this as unknown) === FiantoError) return hasBrand(instance);
    return Function.prototype[Symbol.hasInstance].call(this, instance) as boolean;
  }
}

export interface ApiErrorBody {
  statusCode?: number;
  error?: string;
  code?: string;
  message?: string;
  field?: string;
  details?: string[];
  request_id?: string;
}

/** The API answered with a non-2xx status. `code` is stable; `message` is for humans. */
export class APIError extends FiantoError {
  override name = 'APIError';
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;
  readonly details: string[] | undefined;
  readonly requestId: string | undefined;
  readonly headers: Headers;

  /** @internal Constructed only by the SDK's own transport; `ApiErrorBody` isn't exported. */
  constructor(status: number, body: ApiErrorBody | undefined, headers: Headers) {
    super(body?.message ?? `fianto API answered HTTP ${status}`);
    this.status = status;
    this.code = body?.code ?? 'unknown';
    this.field = body?.field;
    this.details = body?.details;
    this.requestId = body?.request_id ?? headers.get('x-request-id') ?? undefined;
    this.headers = headers;
  }
}

export class AuthenticationError extends APIError { override name = 'AuthenticationError'; }
export class PermissionDeniedError extends APIError { override name = 'PermissionDeniedError'; }
export class InvalidRequestError extends APIError { override name = 'InvalidRequestError'; }
export class NotFoundError extends APIError { override name = 'NotFoundError'; }
export class ConflictError extends APIError { override name = 'ConflictError'; }
export class ServiceUnavailableError extends APIError { override name = 'ServiceUnavailableError'; }
export class InternalServerError extends APIError { override name = 'InternalServerError'; }

export class RateLimitError extends APIError {
  override name = 'RateLimitError';
  readonly retryAfterSeconds: number | undefined;
  /** @internal Constructed only by the SDK's own transport; `ApiErrorBody` isn't exported. */
  constructor(status: number, body: ApiErrorBody | undefined, headers: Headers) {
    super(status, body, headers);
    this.retryAfterSeconds = parseRetryAfter(headers.get('retry-after'));
  }
}

export interface NetworkErrorOptions extends ErrorOptions {
  requestId?: string;
  idempotencyKey?: string;
}

/** The request never produced a response (DNS, TCP, TLS, reset). Retry a POST with `idempotencyKey` to recover. */
export class ConnectionError extends FiantoError {
  override name = 'ConnectionError';
  readonly requestId: string | undefined;
  readonly idempotencyKey: string | undefined;
  /** @internal Constructed only by the SDK's own transport; `NetworkErrorOptions` isn't exported. */
  constructor(message: string, options: NetworkErrorOptions = {}) {
    super(message, options);
    this.requestId = options.requestId;
    this.idempotencyKey = options.idempotencyKey;
  }
}

/** The request did not finish within `timeoutMs`. */
export class TimeoutError extends FiantoError {
  override name = 'TimeoutError';
  readonly code = 'timeout';
  readonly requestId: string | undefined;
  readonly idempotencyKey: string | undefined;
  /** @internal Constructed only by the SDK's own transport; `NetworkErrorOptions` isn't exported. */
  constructor(message: string, options: NetworkErrorOptions = {}) {
    super(message, options);
    this.requestId = options.requestId;
    this.idempotencyKey = options.idempotencyKey;
  }
}

/** `options.signal` was aborted. `cause` is the signal's abort reason. */
export class AbortError extends FiantoError {
  override name = 'AbortError';
  readonly code = 'aborted';
  constructor(reason?: unknown) {
    super('The request was aborted.', { cause: reason });
  }
}

function asBody(body: unknown): ApiErrorBody | undefined {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as ApiErrorBody) : undefined;
}

export function errorFromResponse(status: number, body: unknown, headers: Headers): APIError {
  const parsed = asBody(body);
  switch (true) {
    case status === 401: return new AuthenticationError(status, parsed, headers);
    case status === 403: return new PermissionDeniedError(status, parsed, headers);
    case status === 404: return new NotFoundError(status, parsed, headers);
    case status === 409: return new ConflictError(status, parsed, headers);
    case status === 429: return new RateLimitError(status, parsed, headers);
    case status === 503: return new ServiceUnavailableError(status, parsed, headers);
    case status >= 500: return new InternalServerError(status, parsed, headers);
    case status === 400 || status === 422: return new InvalidRequestError(status, parsed, headers);
    default: return new APIError(status, parsed, headers);
  }
}

/** Retry-After as whole seconds, from delta-seconds or an HTTP date; undefined when absent/garbage. */
export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/**
 * Brand-based, cross-copy-safe check: true for any `FiantoError` (from this copy of the SDK or
 * another), unlike `instanceof <specific subclass>`. With `code`, also narrows on the error's own
 * `.code` — duck-typed, so it works for any branded error that has one, not only `APIError`.
 *
 * There are three stable non-API codes, each narrowing to its own class: `'aborted'`
 * (`AbortError`), `'timeout'` (`TimeoutError`.code) and, from `amounts.ts`, `'invalid_usdc_amount'`
 * (`UsdcError` — not re-exported here to avoid a cycle with `amounts.ts`, so that one code falls
 * through to the generic `FiantoError & { code: C }` overload below instead of its own class).
 * Every other code is assumed to be one of the backend's `ErrorCode`s and narrows to `APIError`;
 * an arbitrary string narrows only to `FiantoError & { code: C }`, never `APIError`, so a caller
 * can't be led into reading `.status` off something that was never an HTTP response.
 */
export function isFiantoError(error: unknown): error is FiantoError;
export function isFiantoError(error: unknown, code: 'aborted'): error is AbortError;
export function isFiantoError(error: unknown, code: 'timeout'): error is TimeoutError;
export function isFiantoError<C extends ErrorCode>(error: unknown, code: C): error is APIError & { code: C };
export function isFiantoError<C extends string>(error: unknown, code: C): error is FiantoError & { code: C };
export function isFiantoError(error: unknown, code?: string): boolean {
  if (!hasBrand(error)) return false;
  if (code === undefined) return true;
  const actual: unknown = (error as { code?: unknown }).code;
  return typeof actual === 'string' && actual === code;
}

/** Brand-based, cross-copy-safe check for the HTTP-response family of errors (has `.status`). */
export function isAPIError(error: unknown): error is APIError {
  return hasBrand(error) && typeof (error as { status?: unknown }).status === 'number';
}
