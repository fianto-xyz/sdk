/** Base class of every error this SDK throws. */
export class FiantoError extends Error {
  override name = 'FiantoError';
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
  constructor(status: number, body: ApiErrorBody | undefined, headers: Headers) {
    super(status, body, headers);
    this.retryAfterSeconds = parseRetryAfter(headers.get('retry-after'));
  }
}

/** The request never produced a response (DNS, TCP, TLS, reset). */
export class ConnectionError extends FiantoError { override name = 'ConnectionError'; }

/** The request did not finish within `timeoutMs`. */
export class TimeoutError extends FiantoError { override name = 'TimeoutError'; }

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

export function isFiantoError(error: unknown): error is FiantoError;
export function isFiantoError<C extends string>(error: unknown, code: C): error is APIError & { code: C };
export function isFiantoError(error: unknown, code?: string): boolean {
  if (!(error instanceof FiantoError)) return false;
  if (code === undefined) return true;
  return error instanceof APIError && error.code === code;
}
