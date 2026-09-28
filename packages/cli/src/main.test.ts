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

const SECRET = 'whsec_' + Buffer.alloc(32, 1).toString('base64');

describe('main: events tail, trigger, sign usage errors', () => {
  it('rejects events tail with no --forward-to and never calls the API', async () => {
    const { d, errors, client } = deps();
    expect(await main(['events', 'tail'], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/--forward-to/);
    expect(client.events.list).not.toHaveBeenCalled();
  });

  it('rejects events tail with no --secret/FIANTO_WEBHOOK_SECRET', async () => {
    const { d, errors, client } = deps();
    expect(await main(['events', 'tail', '--forward-to', 'http://localhost:3000/wh'], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/--secret|FIANTO_WEBHOOK_SECRET/);
    expect(client.events.list).not.toHaveBeenCalled();
  });

  it('rejects an invalid --since', async () => {
    const { d, errors } = deps();
    expect(await main(['events', 'tail', '--forward-to', 'http://localhost:3000/wh', '--secret', SECRET, '--since', 'nope'], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/duration/i);
  });

  it('rejects an --interval below the 500ms minimum', async () => {
    const { d, errors } = deps();
    expect(await main(['events', 'tail', '--forward-to', 'http://localhost:3000/wh', '--secret', SECRET, '--interval', '10'], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/--interval/);
  });

  it('rejects trigger with no event type', async () => {
    const { d, errors, client } = deps();
    expect(await main(['trigger'], d)).toBe(2);
    expect(errors.join('\n')).toContain('Usage: fianto <command> [options]');
    expect(client.webhookEndpoint.sendTestEvent).not.toHaveBeenCalled();
  });

  // Review Focus 4, at the main() level
  it('rejects trigger order.paid with no --forward-to and calls nothing', async () => {
    const { d, errors, client } = deps();
    expect(await main(['trigger', 'order.paid'], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/--forward-to/);
    expect(client.webhookEndpoint.sendTestEvent).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('rejects trigger with an unknown type', async () => {
    const { d, errors } = deps();
    expect(await main(['trigger', 'nope.event'], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/Unknown event type/);
  });

  it('runs trigger test.event end to end through main', async () => {
    const { d, lines, client } = deps();
    client.webhookEndpoint.sendTestEvent.mockResolvedValue({ event_id: 'evt_abc123' });
    expect(await main(['trigger', 'test.event'], d)).toBe(0);
    expect(lines).toEqual(['Sent test.event evt_abc123 to your registered endpoint']);
  });

  it('rejects sign with no --payload', async () => {
    const { d, errors } = deps();
    expect(await main(['sign', '--secret', SECRET], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/--payload/);
  });

  it('rejects sign with no --secret/FIANTO_WEBHOOK_SECRET', async () => {
    const { d, errors } = deps();
    expect(await main(['sign', '--payload', '/nonexistent.json'], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/--secret|FIANTO_WEBHOOK_SECRET/);
  });

  it('runs sign end to end through main and never prints the secret', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'fianto-cli-main-sign-'));
    const file = join(dir, 'payload.json');
    writeFileSync(file, JSON.stringify({ id: 'evt_x', type: 'order.paid', timestamp: '2026-09-28T00:00:00Z', data: {} }));
    const { d, lines } = deps();
    const code = await main(['sign', '--payload', file, '--secret', SECRET], d);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('webhook-id: evt_x');
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  it('wires events tail through main and stops immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { d, lines, client } = deps({ signal: controller.signal });
    const code = await main(['events', 'tail', '--forward-to', 'http://localhost:3000/wh', '--secret', SECRET], d);
    expect(code).toBe(0);
    expect(client.events.list).not.toHaveBeenCalled();
    expect(lines[0]).toBe('Forwarding events from the last 5m to http://localhost:3000/wh (Ctrl-C to stop)');
  });
});
