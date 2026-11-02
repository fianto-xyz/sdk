import { FiantoError } from './errors.js';

/** The production fianto API, used when none of `baseUrl`, `FIANTO_BASE_URL` or a devnet `network` (or test key) is set. */
export const DEFAULT_BASE_URL = 'https://api.fianto.xyz';

/** The sandbox API (test USDC on Solana devnet). It takes only test secret keys (`fian_sk_test_`), never live ones. */
export const DEVNET_BASE_URL = 'https://devnet-api.fianto.xyz';

/** `mainnet` is production (real USDC); `devnet` is the sandbox. */
export type Network = 'mainnet' | 'devnet';

export interface ClientOptions {
  /** Default: process.env.FIANTO_APP_ID */
  appId?: string;
  /** Default: process.env.FIANTO_APP_SECRET. Server-side only. */
  appSecret?: string;
  /**
   * Default: FIANTO_BASE_URL, else the API of `network`. Override for a self-hosted or local
   * backend. It wins over `network` for where requests go, except that the other network's own host
   * (api.fianto.xyz for devnet, devnet-api.fianto.xyz for mainnet) with an explicit `network` throws,
   * and so does either host with the other network's key (a test key on api.fianto.xyz, a live key
   * on devnet-api.fianto.xyz), however the network was set. Other hosts are not checked.
   */
  baseUrl?: string;
  /**
   * `'mainnet'` (production, real USDC; takes a live secret key, `fian_sk_live_`) or `'devnet'` (the
   * sandbox at https://devnet-api.fianto.xyz, test USDC; takes a test secret key, `fian_sk_test_`).
   * Default: FIANTO_NETWORK, else the key's network: `'devnet'` for a `fian_sk_test_` key, otherwise
   * `'mainnet'`. A network that contradicts the key's prefix throws.
   */
  network?: Network;
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
  network: Network;
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
    // Never echo `raw`: it may carry embedded userinfo/credentials (https://user:pass@host).
    throw new FiantoError('Invalid baseUrl: could not be parsed as a URL.');
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  if (!secure) throw new FiantoError('baseUrl must be https:// (http:// is allowed only for localhost).');
  if (url.search || url.hash || url.username || url.password) {
    throw new FiantoError('baseUrl must not carry a query, fragment or credentials.');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function resolveNetwork(value: string | undefined): Network | undefined {
  if (value === undefined) return undefined;
  if (value !== 'mainnet' && value !== 'devnet') throw new FiantoError('Invalid network: expected "mainnet" or "devnet".');
  return value;
}

const KEY_PREFIXES: Record<Network, string> = { mainnet: 'fian_sk_live_', devnet: 'fian_sk_test_' };

/** The network an app secret is for, read from its prefix; undefined for any other shape. */
function keyNetwork(appSecret: string): Network | undefined {
  if (appSecret.startsWith(KEY_PREFIXES.mainnet)) return 'mainnet';
  if (appSecret.startsWith(KEY_PREFIXES.devnet)) return 'devnet';
  return undefined;
}

/** PLACEHOLDER wording (owner rule): every new key/network message, for owner approval. */
const KEY_NETWORK_COPY = {
  keyMismatch: (key: Network, network: Network): string => {
    const [kind, other] = key === 'mainnet' ? ['live', 'test'] : ['test', 'live'];
    return `appSecret is a ${kind} key (${KEY_PREFIXES[key]}) but network is "${network}". Use a ${other} key, or change network.`;
  },
  keyOnOtherHost: (key: Network, baseUrl: string): string => {
    const [kind, other, host] = key === 'mainnet' ? ['live', 'test', 'devnet'] : ['test', 'live', 'mainnet'];
    return (
      `appSecret is a ${kind} key (${KEY_PREFIXES[key]}), for ${key}, but the base URL is ${baseUrl}, the ${host} API. ` +
      `Remove FIANTO_BASE_URL / baseUrl, or use a ${other} key.`
    );
  },
} as const;

export function resolveConfig(options: ClientOptions): ResolvedConfig {
  const g = globalThis as { window?: unknown; document?: unknown; importScripts?: unknown };
  // A page (window + document), or a browser Web Worker: it has neither, but its bundle still
  // ships to the visitor. `importScripts` exists only in browsers' worker scopes (dedicated,
  // shared, service) — not in Cloudflare Workers, Deno, Bun or Vercel Edge, which run on servers.
  const browser = (typeof g.window !== 'undefined' && typeof g.document !== 'undefined') || typeof g.importScripts === 'function';
  if (browser && !options.dangerouslyAllowBrowser) {
    throw new FiantoError(
      'new Fianto() holds your app secret and must not run in a browser. Create checkout sessions on your server ' +
        '(see @fianto/sdk/handlers) and use @fianto/js in the browser. Pass dangerouslyAllowBrowser: true only if you understand the risk.',
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new FiantoError('No fetch implementation: pass options.fetch (Node ≥ 20 has one built in).');
  const explicitNetwork = resolveNetwork(options.network ?? env('FIANTO_NETWORK'));
  // Credentials first: a missing one is reported before an unparseable base URL, as it always was.
  const appId = required(options.appId ?? env('FIANTO_APP_ID'), 'appId', 'FIANTO_APP_ID');
  const appSecret = required(options.appSecret ?? env('FIANTO_APP_SECRET'), 'appSecret', 'FIANTO_APP_SECRET');
  // A live key works only on mainnet and a test key only on devnet: the API would refuse the other
  // with 401 api_key_wrong_network, so say so here. A key with neither prefix is left to the API.
  const fromKey = keyNetwork(appSecret);
  if (explicitNetwork !== undefined && fromKey !== undefined && explicitNetwork !== fromKey) {
    throw new FiantoError(KEY_NETWORK_COPY.keyMismatch(fromKey, explicitNetwork));
  }
  const network: Network = explicitNetwork ?? fromKey ?? 'mainnet';
  const baseUrl = normaliseBaseUrl(
    options.baseUrl ?? env('FIANTO_BASE_URL') ?? (network === 'devnet' ? DEVNET_BASE_URL : DEFAULT_BASE_URL),
  );
  // An EXPLICIT network must not be silently overridden by a stray FIANTO_BASE_URL (or baseUrl)
  // that is the other network's own host: that sends the calls to the wrong network. Any other
  // URL (self-hosted, local) still wins.
  if (options.network !== undefined) {
    const other = network === 'devnet' ? DEFAULT_BASE_URL : DEVNET_BASE_URL;
    if (baseUrl === other) {
      throw new FiantoError(
        `network is "${network}" but the base URL is ${baseUrl}, the ${network === 'devnet' ? 'mainnet' : 'devnet'} API. ` +
          `Remove FIANTO_BASE_URL / baseUrl, or change network.`,
      );
    }
  }
  // However the network or base URL was set, a known key prefix must match a known fianto host:
  // that host would refuse the key (401 api_key_wrong_network). Any other host is not checked.
  const hostNetwork: Network | undefined = baseUrl === DEFAULT_BASE_URL ? 'mainnet' : baseUrl === DEVNET_BASE_URL ? 'devnet' : undefined;
  if (fromKey !== undefined && hostNetwork !== undefined && hostNetwork !== fromKey) {
    throw new FiantoError(KEY_NETWORK_COPY.keyOnOtherHost(fromKey, baseUrl));
  }
  return {
    appId,
    appSecret,
    baseUrl,
    network,
    timeoutMs: options.timeoutMs === undefined ? 30_000 : assertTimeoutMs(options.timeoutMs),
    maxRetries: options.maxRetries === undefined ? 2 : assertMaxRetries(options.maxRetries),
    fetch: fetchImpl.bind(globalThis),
    browser,
  };
}
