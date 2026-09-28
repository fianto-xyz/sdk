import { FiantoError } from './errors.js';
import { DEFAULT_BASE_URL, resolveConfig } from './config.js';

const base = { appId: 'fian_app_x', appSecret: 'fian_sk_live_y', baseUrl: 'https://api.example.com/' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('applies defaults and trims a trailing slash', () => {
  const config = resolveConfig(base);
  expect(config).toMatchObject({ baseUrl: 'https://api.example.com', timeoutMs: 30_000, maxRetries: 2, browser: false });
});

it('reads credentials and base URL from the environment', () => {
  vi.stubEnv('FIANTO_APP_ID', 'fian_app_env');
  vi.stubEnv('FIANTO_APP_SECRET', 'fian_sk_live_env');
  vi.stubEnv('FIANTO_BASE_URL', 'https://env.example.com');
  expect(resolveConfig({})).toMatchObject({ appId: 'fian_app_env', baseUrl: 'https://env.example.com' });
});

it('defaults baseUrl to the production API when no option or env var is set', () => {
  expect(resolveConfig({ appId: 'a', appSecret: 's' }).baseUrl).toBe(DEFAULT_BASE_URL);
  expect(DEFAULT_BASE_URL).toBe('https://api.fianto.xyz');
});

it('lets FIANTO_BASE_URL override the default', () => {
  vi.stubEnv('FIANTO_BASE_URL', 'https://env.example.com');
  expect(resolveConfig({ appId: 'a', appSecret: 's' }).baseUrl).toBe('https://env.example.com');
});

it('lets the baseUrl option override the environment and the default', () => {
  vi.stubEnv('FIANTO_BASE_URL', 'https://env.example.com');
  expect(resolveConfig({ appId: 'a', appSecret: 's', baseUrl: 'https://option.example.com' }).baseUrl).toBe(
    'https://option.example.com',
  );
});

it('names the missing environment variable', () => {
  expect(() => resolveConfig({ baseUrl: 'https://x.test', appSecret: 's' })).toThrow(/FIANTO_APP_ID/);
  expect(() => resolveConfig({ baseUrl: 'https://x.test', appId: 'a' })).toThrow(/FIANTO_APP_SECRET/);
});

it('never echoes credentials or userinfo from an unparseable baseUrl', () => {
  const evil = 'https://user:hunter2@[::1'; // unparseable: unterminated IPv6 literal
  expect(() => resolveConfig({ ...base, baseUrl: evil })).toThrow(FiantoError);
  let message = '';
  try {
    resolveConfig({ ...base, baseUrl: evil });
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message.length).toBeGreaterThan(0);
  expect(message).not.toContain('hunter2');
  expect(message).not.toContain('user:');
});

it('refuses plain http except on localhost', () => {
  expect(() => resolveConfig({ ...base, baseUrl: 'http://api.example.com' })).toThrow(FiantoError);
  expect(resolveConfig({ ...base, baseUrl: 'http://localhost:3000' }).baseUrl).toBe('http://localhost:3000');
  expect(resolveConfig({ ...base, baseUrl: 'http://127.0.0.1:3000' }).baseUrl).toBe('http://127.0.0.1:3000');
});

it('refuses to hold a secret in a browser unless told to', () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {});
  expect(() => resolveConfig(base)).toThrow(/browser/);
  expect(resolveConfig({ ...base, dangerouslyAllowBrowser: true }).browser).toBe(true);
});

// C15: a Web Worker has no window or document, but its bundle ships to the visitor all the same.
it('refuses to hold a secret in a browser Web Worker unless told to', () => {
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('WorkerGlobalScope', function WorkerGlobalScope() {});
  vi.stubGlobal('importScripts', () => {});
  expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
  expect(() => resolveConfig(base)).toThrow(/browser/);
  expect(resolveConfig({ ...base, dangerouslyAllowBrowser: true }).browser).toBe(true);
});

it('still runs on server runtimes with worker-like globals but no importScripts (Cloudflare Workers)', () => {
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('WorkerGlobalScope', function WorkerGlobalScope() {});
  vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
  expect(resolveConfig(base).browser).toBe(false);
});

it('rejects an out-of-range or non-integer maxRetries', () => {
  for (const bad of [Number.NaN, -1, 11, 1.5, Infinity]) {
    expect(() => resolveConfig({ ...base, maxRetries: bad })).toThrow(/maxRetries/);
  }
  expect(resolveConfig({ ...base, maxRetries: 0 }).maxRetries).toBe(0);
  expect(resolveConfig({ ...base, maxRetries: 10 }).maxRetries).toBe(10);
});

it('rejects an out-of-range or non-integer timeoutMs', () => {
  for (const bad of [Number.NaN, 0, -1, 600_001, 1.5, Infinity]) {
    expect(() => resolveConfig({ ...base, timeoutMs: bad })).toThrow(/timeoutMs/);
  }
  expect(resolveConfig({ ...base, timeoutMs: 1 }).timeoutMs).toBe(1);
  expect(resolveConfig({ ...base, timeoutMs: 600_000 }).timeoutMs).toBe(600_000);
});
