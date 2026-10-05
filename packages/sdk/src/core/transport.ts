import { VERSION } from '../version.js';
import { assertMaxRetries, assertTimeoutMs, type ResolvedConfig } from './config.js';
import { AbortError, ConnectionError, FiantoError, TimeoutError, errorFromResponse, parseRetryAfter, type APIError } from './errors.js';
import { assertIdempotencyKey } from './ids.js';

export interface RequestOptions {
  /** Default for POST: a UUID generated once per call and reused on every retry. */
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRetries?: number;
}

export interface ApiRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface TransportDeps {
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  random(): number;
  now(): number;
}

/** A response body that did not parse as JSON. */
class NotJson {
  constructor(readonly text: string) {}
}

const RETRYABLE_409 = new Set(['idempotency_request_in_progress', 'checkout_unavailable']);
/** A retryable response whose Retry-After exceeds this is never waited on: it throws at once. */
const MAX_RETRY_AFTER_MS = 10_000;
const MAX_BACKOFF_MS = 8_000;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * True for a response `fetch` returned instead of following, because every request is sent with
 * `redirect: 'manual'` (see the request loop below — `redirect: 'error'` throws a TypeError while
 * *constructing* the request on Cloudflare Workers/workerd, which isn't in the try/catch's retry
 * path and would fail every request there). Most runtimes hand back an opaque, unreadable
 * response (`type: 'opaqueredirect'`, status 0) for a manually-handled redirect; some (workerd
 * observed) instead pass the real 3xx response through, so both are checked.
 */
function isRedirectResponse(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

/**
 * Codes on a normally retryable status that no retry within one call can fix:
 * `plan_limit_reached` (429) is a per-day cap sent with no Retry-After, and
 * `subscriptions_paused` (503) is a switch that only changes when fianto restarts.
 */
const FINAL = new Set(['plan_limit_reached', 'subscriptions_paused']);

function isRetryable(error: APIError): boolean {
  if (FINAL.has(error.code)) return false;
  return error.status === 408 || error.status === 429 || error.status >= 500
    || (error.status === 409 && RETRYABLE_409.has(error.code));
}

function runtimeName(): string {
  const g = globalThis as { Bun?: unknown; Deno?: { version?: { deno?: string } }; process?: { versions?: { node?: string } }; navigator?: { userAgent?: string } };
  if (g.Bun) return 'bun';
  if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}`;
  if (g.process?.versions?.node) return `node/${g.process.versions.node}`;
  return g.navigator?.userAgent === 'Cloudflare-Workers' ? 'workerd' : 'unknown';
}

/**
 * Combines several AbortSignals into one, without `AbortSignal.any` (added in Node 20.3 and most
 * browsers, but missing on some Edge runtimes — e.g. Next.js Edge, per the release audit — where
 * every request would otherwise fail outright). `cleanup()` removes the listeners this added;
 * call it once the operation this signal guards has settled.
 */
function anySignal(signals: readonly AbortSignal[]): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const teardown: Array<() => void> = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    teardown.push(() => signal.removeEventListener('abort', onAbort));
  }
  return { signal: controller.signal, cleanup: () => { for (const fn of teardown) fn(); } };
}

/**
 * A signal that aborts after `ms`, built from `setTimeout` + `AbortController` rather than
 * `AbortSignal.timeout` (same Edge-runtime doubt as `anySignal`). Aborts with a DOMException
 * named `'TimeoutError'`, the same shape `AbortSignal.timeout` uses, so the request's catch
 * block still tells a timeout apart from any other failure by `error.name`.
 */
function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`The operation timed out after ${ms} ms`, 'TimeoutError')),
    ms,
  );
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export class Transport {
  readonly #config: ResolvedConfig;
  private readonly deps: TransportDeps;
  private readonly userAgent = `fianto-sdk/${VERSION} (${runtimeName()})`;

  constructor(config: ResolvedConfig, deps: Partial<TransportDeps> = {}) {
    this.#config = config;
    this.deps = { sleep: defaultSleep, random: Math.random, now: Date.now, ...deps };
  }

  async request<T>(request: ApiRequest, options: RequestOptions = {}): Promise<T> {
    const maxRetries = options.maxRetries === undefined ? this.#config.maxRetries : assertMaxRetries(options.maxRetries);
    const timeoutMs = options.timeoutMs === undefined ? this.#config.timeoutMs : assertTimeoutMs(options.timeoutMs);
    const idempotencyKey = request.method === 'POST' ? (options.idempotencyKey ?? crypto.randomUUID()) : undefined;
    if (idempotencyKey !== undefined) assertIdempotencyKey(idempotencyKey);
    const requestId = `req_${crypto.randomUUID().replaceAll('-', '')}`;
    const url = this.url(request);
    const headers = new Headers({
      authorization: `Basic ${btoa(`${this.#config.appId}:${this.#config.appSecret}`)}`,
      accept: 'application/json',
      'x-request-id': requestId,
    });
    if (!this.#config.browser) headers.set('user-agent', this.userAgent);
    if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey);
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    if (body !== undefined) headers.set('content-type', 'application/json');

    for (let attempt = 0; ; attempt++) {
      const last = attempt >= maxRetries;
      let response: Response;
      let parsed: unknown;
      const timeout = timeoutSignal(timeoutMs);
      const combined = anySignal(options.signal ? [timeout.signal, options.signal] : [timeout.signal]);
      try {
        try {
          // Never 'error': it throws while constructing the request on workerd (Cloudflare
          // Workers), before there's even a response to inspect. 'manual' lets us classify a
          // redirect ourselves below and still never follow one.
          response = await this.#config.fetch(url, {
            method: request.method, headers, body, signal: combined.signal, redirect: 'manual',
          });
          if (!isRedirectResponse(response)) parsed = await this.parse(response);
        } catch (error) {
          if (options.signal?.aborted) throw new AbortError(options.signal.reason);
          // Whether OUR timeout fired, not the failure's `.name` — a runtime's own abort/network
          // error could coincidentally be named 'TimeoutError' for an unrelated reason.
          const failure = timeout.signal.aborted
            ? new TimeoutError(`fianto API request timed out after ${timeoutMs} ms`, { cause: error, requestId, idempotencyKey })
            : new ConnectionError('Could not reach the fianto API', { cause: error, requestId, idempotencyKey });
          if (last) throw failure;
          await this.wait(this.backoff(attempt), options.signal);
          continue;
        }
      } finally {
        timeout.cancel();
        combined.cleanup();
      }
      // A redirect is never followed and never retried — one bad response is treated as final,
      // the same way a non-retryable API error is below.
      if (isRedirectResponse(response)) {
        throw new ConnectionError(
          `fianto API tried to redirect this request (request ${requestId}); redirects are never followed`,
          { requestId, idempotencyKey },
        );
      }
      if (response.ok) {
        if (parsed instanceof NotJson) throw new FiantoError(`fianto API answered HTTP ${response.status} with a body that is not JSON (request ${requestId})`);
        return parsed as T;
      }
      const error = errorFromResponse(response.status, parsed instanceof NotJson ? parsed.text : parsed, response.headers);
      if (!isRetryable(error)) throw error;
      // A2: don't wait out a Retry-After longer than MAX_RETRY_AFTER_MS — throw at once instead
      // of holding the caller (a checkout popup, a CLI command) for minutes.
      const retryAfterMs = this.retryAfterMs(response.headers);
      if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) throw error;
      if (last) throw error;
      await this.wait(retryAfterMs ?? this.backoff(attempt), options.signal);
    }
  }

  private url(request: ApiRequest): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const query = search.toString();
    return `${this.#config.baseUrl}${request.path}${query ? `?${query}` : ''}`;
  }

  private async parse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return new NotJson(text);
    }
  }

  /** Wraps `deps.sleep`: a caller abort during the wait rejects with `AbortError`, not the raw reason. */
  private async wait(ms: number, signal?: AbortSignal): Promise<void> {
    try {
      await this.deps.sleep(ms, signal);
    } catch (error) {
      if (signal?.aborted) throw new AbortError(signal.reason);
      throw error;
    }
  }

  private retryAfterMs(headers: Headers): number | undefined {
    const seconds = parseRetryAfter(headers.get('retry-after'), this.deps.now());
    return seconds === undefined ? undefined : seconds * 1000;
  }

  private backoff(attempt: number): number {
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
    return Math.round(base * (0.75 + this.deps.random() * 0.5));
  }
}
