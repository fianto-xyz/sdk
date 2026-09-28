import { describe, expect, it, vi } from 'vitest';
import { main, type Deps } from './main.js';

function deps(overrides: Partial<Deps> = {}) {
  const lines: string[] = []; const errors: string[] = [];
  const client = {
    application: { retrieve: vi.fn(async () => ({ app_id: 'fian_app_1', name: 'Shop', merchant: { name: 'Acme' }, webhook: { status: 'ACTIVE', url: 'https://shop.test/wh' } })) },
    events: { list: vi.fn(), retrieve: vi.fn() },
    webhookEndpoint: { sendTestEvent: vi.fn() },
  };
  const d: Deps = {
    output: { out: (l) => lines.push(l), err: (l) => errors.push(l) },
    env: { FIANTO_APP_ID: 'fian_app_1', FIANTO_APP_SECRET: 'fian_sk_live_SECRETVALUE', FIANTO_BASE_URL: 'https://api.test' },
    makeClient: vi.fn(() => client as never),
    fetch: vi.fn() as never, now: () => 0, sleep: async () => {},
    ...overrides,
  };
  return { d, lines, errors, client };
}

describe('main', () => {
  it('prints usage and exits 2 for an unknown command', async () => {
    const { d, errors } = deps();
    expect(await main(['nope'], d)).toBe(2);
    expect(errors.join('\n')).toContain('Usage: fianto <command> [options]');
  });

  it('runs whoami with env credentials', async () => {
    const { d, lines } = deps();
    expect(await main(['whoami'], d)).toBe(0);
    expect(lines).toEqual(['Application  Shop (fian_app_1)', 'Merchant     Acme', 'Webhook      ACTIVE https://shop.test/wh']);
  });

  it('prefers flags over env and names a missing credential', async () => {
    const { d, errors } = deps({ env: {} });
    expect(await main(['whoami', '--app-id', 'a'], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/--app-secret|FIANTO_APP_SECRET/);
  });

  // Review Focus 3
  it('never prints the app secret, even in errors', async () => {
    const { d, lines, errors, client } = deps();
    client.application.retrieve.mockRejectedValue(Object.assign(new Error('bad creds'), { code: 'invalid_api_credentials', requestId: 'req_12345678', status: 401 }));
    await main(['whoami'], d);
    await main(['--help'], d);
    expect([...lines, ...errors].join('\n')).not.toContain('SECRETVALUE');
  });

  it('reports an API error with code and request id and exits 1', async () => {
    const { APIError } = await import('@fianto/sdk');
    const { d, errors, client } = deps();
    client.application.retrieve.mockRejectedValue(new APIError(401, { code: 'invalid_api_credentials', message: 'Bad credentials', request_id: 'req_abcdefgh' }, new Headers()));
    expect(await main(['whoami'], d)).toBe(1);
    expect(errors.join('\n')).toContain('invalid_api_credentials');
    expect(errors.join('\n')).toContain('req_abcdefgh');
  });

  it('prints usage and exits 0 for --help without touching credentials', async () => {
    const { d, lines, errors } = deps({ env: {} });
    expect(await main(['--help'], d)).toBe(0);
    expect(lines.join('\n')).toContain('Usage: fianto <command> [options]');
    expect(errors).toEqual([]);
  });
});
