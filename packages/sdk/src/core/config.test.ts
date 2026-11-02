import { FiantoError } from './errors.js';
import { DEFAULT_BASE_URL, DEVNET_BASE_URL, resolveConfig } from './config.js';

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

it('reports missing credentials before an unparseable baseUrl, as before the network option', () => {
  expect(() => resolveConfig({ baseUrl: 'not a url', appSecret: 's' })).toThrow(/FIANTO_APP_ID/);
  expect(() => resolveConfig({ baseUrl: 'not a url', appId: 'a' })).toThrow(/FIANTO_APP_SECRET/);
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

describe('network', () => {
  const creds = { appId: 'a', appSecret: 's' };

  it('defaults to mainnet on the production API', () => {
    expect(resolveConfig(creds)).toMatchObject({ network: 'mainnet', baseUrl: 'https://api.fianto.xyz' });
  });

  it("resolves network: 'devnet' to the devnet API", () => {
    expect(DEVNET_BASE_URL).toBe('https://devnet-api.fianto.xyz');
    expect(resolveConfig({ ...creds, network: 'devnet' })).toMatchObject({ network: 'devnet', baseUrl: DEVNET_BASE_URL });
  });

  it('reads FIANTO_NETWORK', () => {
    vi.stubEnv('FIANTO_NETWORK', 'devnet');
    expect(resolveConfig(creds)).toMatchObject({ network: 'devnet', baseUrl: DEVNET_BASE_URL });
  });

  it('treats an empty FIANTO_NETWORK as unset', () => {
    vi.stubEnv('FIANTO_NETWORK', '');
    expect(resolveConfig(creds)).toMatchObject({ network: 'mainnet', baseUrl: DEFAULT_BASE_URL });
  });

  it('lets the network option override FIANTO_NETWORK', () => {
    vi.stubEnv('FIANTO_NETWORK', 'devnet');
    expect(resolveConfig({ ...creds, network: 'mainnet' })).toMatchObject({ network: 'mainnet', baseUrl: DEFAULT_BASE_URL });
  });

  it('lets baseUrl win over network, which is still reported', () => {
    expect(resolveConfig({ ...creds, network: 'devnet', baseUrl: 'https://own.example.com' })).toMatchObject({
      network: 'devnet',
      baseUrl: 'https://own.example.com',
    });
  });

  it('lets FIANTO_BASE_URL win over the network', () => {
    vi.stubEnv('FIANTO_BASE_URL', 'https://env.example.com');
    expect(resolveConfig({ ...creds, network: 'devnet' })).toMatchObject({ network: 'devnet', baseUrl: 'https://env.example.com' });
  });

  describe('an explicit network that the base URL contradicts', () => {
    it("throws for network: 'devnet' with FIANTO_BASE_URL set to the production API, naming both", () => {
      vi.stubEnv('FIANTO_BASE_URL', 'https://api.fianto.xyz');
      const attempt = () => resolveConfig({ ...creds, network: 'devnet' });
      expect(attempt).toThrow(FiantoError);
      expect(attempt).toThrow(/devnet/);
      expect(attempt).toThrow(/https:\/\/api\.fianto\.xyz/);
    });

    it("throws for network: 'mainnet' with the devnet API as FIANTO_BASE_URL, even with a trailing slash", () => {
      vi.stubEnv('FIANTO_BASE_URL', `${DEVNET_BASE_URL}/`);
      expect(() => resolveConfig({ ...creds, network: 'mainnet' })).toThrow(/mainnet/);
    });

    it('throws for an explicit baseUrl option that is the other network\'s host', () => {
      expect(() => resolveConfig({ ...creds, network: 'devnet', baseUrl: 'https://api.fianto.xyz/' })).toThrow(FiantoError);
      expect(() => resolveConfig({ ...creds, network: 'mainnet', baseUrl: DEVNET_BASE_URL })).toThrow(FiantoError);
    });

    it('lets a custom or self-hosted URL win silently', () => {
      vi.stubEnv('FIANTO_BASE_URL', 'https://self-hosted.example.com');
      expect(resolveConfig({ ...creds, network: 'devnet' })).toMatchObject({ baseUrl: 'https://self-hosted.example.com' });
    });

    it('accepts a base URL that matches the explicit network', () => {
      vi.stubEnv('FIANTO_BASE_URL', DEVNET_BASE_URL);
      expect(resolveConfig({ ...creds, network: 'devnet' })).toMatchObject({ baseUrl: DEVNET_BASE_URL });
    });

    it('keeps today\'s behaviour when the network is not explicit', () => {
      vi.stubEnv('FIANTO_BASE_URL', 'https://api.fianto.xyz');
      vi.stubEnv('FIANTO_NETWORK', 'devnet');
      expect(resolveConfig(creds)).toMatchObject({ network: 'devnet', baseUrl: 'https://api.fianto.xyz' });
      expect(resolveConfig({ ...creds, baseUrl: DEVNET_BASE_URL })).toMatchObject({ network: 'devnet', baseUrl: DEVNET_BASE_URL });
    });
  });

  describe('the network the app secret is for', () => {
    const live = { appId: 'a', appSecret: 'fian_sk_live_abc' };
    const test = { appId: 'a', appSecret: 'fian_sk_test_abc' };

    it('live key, no network: mainnet on the production API (unchanged)', () => {
      expect(resolveConfig(live)).toMatchObject({ network: 'mainnet', baseUrl: DEFAULT_BASE_URL });
    });

    it('test key, no network: devnet on the devnet API', () => {
      expect(resolveConfig(test)).toMatchObject({ network: 'devnet', baseUrl: DEVNET_BASE_URL });
    });

    it('test key from FIANTO_APP_SECRET, no network: devnet', () => {
      vi.stubEnv('FIANTO_APP_SECRET', 'fian_sk_test_env');
      expect(resolveConfig({ appId: 'a' })).toMatchObject({ network: 'devnet', baseUrl: DEVNET_BASE_URL });
    });

    it('an empty FIANTO_NETWORK still lets a test key pick devnet', () => {
      vi.stubEnv('FIANTO_NETWORK', '');
      expect(resolveConfig(test)).toMatchObject({ network: 'devnet', baseUrl: DEVNET_BASE_URL });
    });

    it('a key with neither prefix keeps the old default and is not checked', () => {
      expect(resolveConfig({ appId: 'a', appSecret: 'fian_sk_other' })).toMatchObject({ network: 'mainnet', baseUrl: DEFAULT_BASE_URL });
      expect(resolveConfig({ appId: 'a', appSecret: 's', network: 'devnet' })).toMatchObject({ network: 'devnet' });
      expect(resolveConfig({ appId: 'a', appSecret: 's', network: 'mainnet' })).toMatchObject({ network: 'mainnet' });
    });

    it('accepts an explicit network that matches the key', () => {
      expect(resolveConfig({ ...live, network: 'mainnet' })).toMatchObject({ network: 'mainnet', baseUrl: DEFAULT_BASE_URL });
      expect(resolveConfig({ ...test, network: 'devnet' })).toMatchObject({ network: 'devnet', baseUrl: DEVNET_BASE_URL });
    });

    it("refuses a live key with network: 'devnet'", () => {
      expect(() => resolveConfig({ ...live, network: 'devnet' })).toThrow(FiantoError);
      expect(() => resolveConfig({ ...live, network: 'devnet' })).toThrow(
        'appSecret is a live key (fian_sk_live_) but network is "devnet". Use a test key, or change network.',
      );
    });

    it("refuses a test key with network: 'mainnet'", () => {
      expect(() => resolveConfig({ ...test, network: 'mainnet' })).toThrow(FiantoError);
      expect(() => resolveConfig({ ...test, network: 'mainnet' })).toThrow(
        'appSecret is a test key (fian_sk_test_) but network is "mainnet". Use a live key, or change network.',
      );
    });

    it('refuses a key that FIANTO_NETWORK contradicts', () => {
      vi.stubEnv('FIANTO_NETWORK', 'mainnet');
      expect(() => resolveConfig(test)).toThrow(/test key.*"mainnet"/);
      vi.stubEnv('FIANTO_NETWORK', 'devnet');
      expect(() => resolveConfig(live)).toThrow(/live key.*"devnet"/);
    });

    it('refuses a mismatch even when baseUrl points somewhere else', () => {
      expect(() => resolveConfig({ ...test, network: 'mainnet', baseUrl: 'http://localhost:3000' })).toThrow(FiantoError);
    });

    it('refuses a test key whose base URL is the production API, naming both', () => {
      vi.stubEnv('FIANTO_BASE_URL', 'https://api.fianto.xyz/');
      const attempt = () => resolveConfig(test);
      expect(attempt).toThrow(FiantoError);
      expect(attempt).toThrow(/devnet/);
      expect(attempt).toThrow(/https:\/\/api\.fianto\.xyz/);
      vi.unstubAllEnvs();
      expect(() => resolveConfig({ ...test, baseUrl: DEFAULT_BASE_URL })).toThrow(FiantoError);
    });

    it('refuses a live key whose base URL is the devnet API, with no network set', () => {
      expect(() => resolveConfig({ ...live, baseUrl: DEVNET_BASE_URL })).toThrow(FiantoError);
      expect(() => resolveConfig({ ...live, baseUrl: DEVNET_BASE_URL })).toThrow(
        `appSecret is a live key (fian_sk_live_), for mainnet, but the base URL is ${DEVNET_BASE_URL}, the devnet API.`,
      );
      vi.stubEnv('FIANTO_BASE_URL', `${DEVNET_BASE_URL}/`);
      expect(() => resolveConfig(live)).toThrow(/live key.*devnet API/);
    });

    it('refuses a test key on the production API with FIANTO_NETWORK=devnet', () => {
      vi.stubEnv('FIANTO_NETWORK', 'devnet');
      vi.stubEnv('FIANTO_BASE_URL', DEFAULT_BASE_URL);
      expect(() => resolveConfig(test)).toThrow(FiantoError);
      expect(() => resolveConfig(test)).toThrow(/test key.*mainnet API/);
    });

    it('refuses a key on the other host even with a matching explicit network', () => {
      expect(() => resolveConfig({ ...live, network: 'mainnet', baseUrl: DEVNET_BASE_URL })).toThrow(FiantoError);
      expect(() => resolveConfig({ ...test, network: 'devnet', baseUrl: DEFAULT_BASE_URL })).toThrow(FiantoError);
    });

    it('accepts each key on its own host, however it was set', () => {
      expect(resolveConfig({ ...live, baseUrl: DEFAULT_BASE_URL })).toMatchObject({ network: 'mainnet', baseUrl: DEFAULT_BASE_URL });
      expect(resolveConfig({ ...test, baseUrl: DEVNET_BASE_URL })).toMatchObject({ network: 'devnet', baseUrl: DEVNET_BASE_URL });
      vi.stubEnv('FIANTO_BASE_URL', DEFAULT_BASE_URL);
      expect(resolveConfig(live)).toMatchObject({ network: 'mainnet', baseUrl: DEFAULT_BASE_URL });
    });

    it('keeps the explicit-network host message for a key with no known prefix', () => {
      expect(() => resolveConfig({ appId: 'a', appSecret: 's', network: 'devnet', baseUrl: DEFAULT_BASE_URL })).toThrow(
        `network is "devnet" but the base URL is ${DEFAULT_BASE_URL}, the mainnet API.`,
      );
    });

    it('lets a live key use a custom or local base URL', () => {
      expect(resolveConfig({ ...live, baseUrl: 'http://localhost:3000' })).toMatchObject({ network: 'mainnet', baseUrl: 'http://localhost:3000' });
    });

    it('lets a test key use a custom or local base URL', () => {
      expect(resolveConfig({ ...test, baseUrl: 'http://localhost:3000' })).toMatchObject({ network: 'devnet', baseUrl: 'http://localhost:3000' });
    });

    it('still reports a missing appId before checking the key', () => {
      expect(() => resolveConfig({ appSecret: 'fian_sk_test_abc', network: 'mainnet' })).toThrow(/FIANTO_APP_ID/);
    });
  });

  it('rejects an unknown network, from the option or the environment', () => {
    const message = 'Invalid network: expected "mainnet" or "devnet".';
    expect(() => resolveConfig({ ...creds, network: 'testnet' as never })).toThrow(message);
    vi.stubEnv('FIANTO_NETWORK', 'testnet');
    expect(() => resolveConfig(creds)).toThrow(FiantoError);
    expect(() => resolveConfig(creds)).toThrow(message);
  });
});
