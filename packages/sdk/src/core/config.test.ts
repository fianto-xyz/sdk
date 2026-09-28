import { FiantoError } from './errors.js';
import { resolveConfig } from './config.js';

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

it('names the missing environment variable', () => {
  expect(() => resolveConfig({ appId: 'a', appSecret: 's' })).toThrow(/FIANTO_BASE_URL/);
  expect(() => resolveConfig({ baseUrl: 'https://x.test', appSecret: 's' })).toThrow(/FIANTO_APP_ID/);
  expect(() => resolveConfig({ baseUrl: 'https://x.test', appId: 'a' })).toThrow(/FIANTO_APP_SECRET/);
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
