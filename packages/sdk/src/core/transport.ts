import { VERSION } from '../version.js';
import { assertMaxRetries, assertTimeoutMs, type ResolvedConfig } from './config.js';
import { ConnectionError, FiantoError, TimeoutError, errorFromResponse, parseRetryAfter, type APIError } from './errors.js';
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
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_BACKOFF_MS = 8_000;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryable(error: APIError): boolean {
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

export class Transport {
  private readonly deps: TransportDeps;
  private readonly userAgent = `fianto-sdk/${VERSION} (${runtimeName()})`;

  constructor(private readonly config: ResolvedConfig, deps: Partial<TransportDeps> = {}) {
    this.deps = { sleep: defaultSleep, random: Math.random, now: Date.now, ...deps };
  }

  async request<T>(request: ApiRequest, options: RequestOptions = {}): Promise<T> {
    const maxRetries = options.maxRetries === undefined ? this.config.maxRetries : assertMaxRetries(options.maxRetries);
    const timeoutMs = options.timeoutMs === undefined ? this.config.timeoutMs : assertTimeoutMs(options.timeoutMs);
    const idempotencyKey = request.method === 'POST' ? (options.idempotencyKey ?? crypto.randomUUID()) : undefined;
    if (idempotencyKey !== undefined) assertIdempotencyKey(idempotencyKey);
    const requestId = `req_${crypto.randomUUID().replaceAll('-', '')}`;
    const url = this.url(request);
    const headers = new Headers({
      authorization: `Basic ${btoa(`${this.config.appId}:${this.config.appSecret}`)}`,
      accept: 'application/json',
      'x-request-id': requestId,
    });
    if (!this.config.browser) headers.set('user-agent', this.userAgent);
    if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey);
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    if (body !== undefined) headers.set('content-type', 'application/json');

    for (let attempt = 0; ; attempt++) {
      const last = attempt >= maxRetries;
      let response: Response;
      let parsed: unknown;
      try {
        const signals = [AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])];
        response = await this.config.fetch(url, { method: request.method, headers, body, signal: AbortSignal.any(signals) });
        parsed = await this.parse(response);
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason ?? error;
        const failure = (error as { name?: string })?.name === 'TimeoutError'
          ? new TimeoutError(`fianto API request timed out after ${timeoutMs} ms`, { cause: error, requestId, idempotencyKey })
          : new ConnectionError('Could not reach the fianto API', { cause: error, requestId, idempotencyKey });
        if (last) throw failure;
        await this.deps.sleep(this.backoff(attempt), options.signal);
        continue;
      }
      if (response.ok) {
        if (parsed instanceof NotJson) throw new FiantoError(`fianto API answered HTTP ${response.status} with a body that is not JSON (request ${requestId})`);
        return parsed as T;
      }
      const error = errorFromResponse(response.status, parsed instanceof NotJson ? parsed.text : parsed, response.headers);
      if (last || !isRetryable(error)) throw error;
      await this.deps.sleep(this.retryDelay(attempt, response.headers), options.signal);
    }
  }

  private url(request: ApiRequest): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const query = search.toString();
    return `${this.config.baseUrl}${request.path}${query ? `?${query}` : ''}`;
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

  private retryDelay(attempt: number, headers: Headers): number {
    const seconds = parseRetryAfter(headers.get('retry-after'), this.deps.now());
    if (seconds !== undefined) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    return this.backoff(attempt);
  }

  private backoff(attempt: number): number {
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
    return Math.round(base * (0.75 + this.deps.random() * 0.5));
  }
}
