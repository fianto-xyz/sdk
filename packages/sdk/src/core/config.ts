import { FiantoError } from './errors.js';

/** The production fianto API, used when neither `baseUrl` nor `FIANTO_BASE_URL` is set. */
export const DEFAULT_BASE_URL = 'https://api.fianto.xyz';

export interface ClientOptions {
  /** Default: process.env.FIANTO_APP_ID */
  appId?: string;
  /** Default: process.env.FIANTO_APP_SECRET. Server-side only. */
  appSecret?: string;
  /** Default: FIANTO_BASE_URL, else https://api.fianto.xyz. Override for devnet, self-hosting or a local backend. */
  baseUrl?: string;
  /** Per attempt. Default 30 000. */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Allow construction where `window` exists. Your app secret would ship to every visitor. */
  dangerouslyAllowBrowser?: boolean;
}

export interface ResolvedConfig {
  appId: string;
  appSecret: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: typeof fetch;
  browser: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  return value === '' ? undefined : value;
}

function required(value: string | undefined, option: string, variable: string): string {
  if (!value) throw new FiantoError(`Missing ${option}: pass it to new Fianto({ ${option} }) or set ${variable}.`);
  return value;
}

/** Shared by `resolveConfig` and `Transport`'s per-request `RequestOptions` override. */
export function assertMaxRetries(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new FiantoError(`Invalid maxRetries (${value}): expected an integer from 0 to 10.`);
  }
  return value;
}

/** Shared by `resolveConfig` and `Transport`'s per-request `RequestOptions` override. */
export function assertTimeoutMs(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 600_000) {
    throw new FiantoError(`Invalid timeoutMs (${value}): expected an integer from 1 to 600000.`);
  }
  return value;
}

function normaliseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FiantoError(`Invalid baseUrl ${JSON.stringify(raw)}.`);
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  if (!secure) throw new FiantoError('baseUrl must be https:// (http:// is allowed only for localhost).');
  if (url.search || url.hash || url.username || url.password) {
    throw new FiantoError('baseUrl must not carry a query, fragment or credentials.');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

export function resolveConfig(options: ClientOptions): ResolvedConfig {
  const browser = typeof (globalThis as { window?: unknown }).window !== 'undefined'
    && typeof (globalThis as { document?: unknown }).document !== 'undefined';
  if (browser && !options.dangerouslyAllowBrowser) {
    throw new FiantoError(
      'new Fianto() holds your app secret and must not run in a browser. Create checkout sessions on your server ' +
        '(see @fianto/sdk/handlers) and use @fianto/js in the browser. Pass dangerouslyAllowBrowser: true only if you understand the risk.',
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new FiantoError('No fetch implementation: pass options.fetch (Node ≥ 20 has one built in).');
  return {
    appId: required(options.appId ?? env('FIANTO_APP_ID'), 'appId', 'FIANTO_APP_ID'),
    appSecret: required(options.appSecret ?? env('FIANTO_APP_SECRET'), 'appSecret', 'FIANTO_APP_SECRET'),
    baseUrl: normaliseBaseUrl(options.baseUrl ?? env('FIANTO_BASE_URL') ?? DEFAULT_BASE_URL),
    timeoutMs: options.timeoutMs === undefined ? 30_000 : assertTimeoutMs(options.timeoutMs),
    maxRetries: options.maxRetries === undefined ? 2 : assertMaxRetries(options.maxRetries),
    fetch: fetchImpl.bind(globalThis),
    browser,
  };
}
