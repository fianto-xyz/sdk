import { describe, expect, it, vi } from 'vitest';
import { UsageError } from '../config.js';
import { trigger } from './trigger.js';

const secret = 'whsec_' + Buffer.alloc(32, 1).toString('base64');

function fakeDeps() {
  const lines: string[] = [];
  const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
  return { output: { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) }, fetch, lines };
}

/** A getClient that fails the test if it's ever invoked — proves a branch never needs the API. */
function noClient(): never {
  throw new Error('must not construct a client for this branch');
}

describe('trigger', () => {
  it('sends test.event via the API and prints its id when there is no --forward-to', async () => {
    const { output, fetch, lines } = fakeDeps();
    const client = { webhookEndpoint: { sendTestEvent: vi.fn(async () => ({ event_id: 'evt_abc123' })) } };
    await trigger('test.event', {}, () => client as never, { fetch: fetch as never, output });
    expect(client.webhookEndpoint.sendTestEvent).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(lines).toEqual(['Sent test.event evt_abc123 to your registered endpoint']);
  });

  it('POSTs a signed local sample for a known business event when --forward-to is given, never calls the API, and never constructs a client', async () => {
    const { output, fetch, lines } = fakeDeps();
    await trigger('order.paid', { forwardTo: 'http://localhost:3000/wh', secret }, noClient, { fetch: fetch as never, output });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/wh');
    expect(JSON.parse((init as RequestInit).body as string).type).toBe('order.paid');
    expect(lines).toEqual(['→ 200 order.paid (local sample)']);
  });

  // Review Focus 4
  it('refuses a known business event with no --forward-to, and calls nothing', async () => {
    const { output, fetch } = fakeDeps();
    const client = { webhookEndpoint: { sendTestEvent: vi.fn() } };
    await expect(trigger('order.paid', {}, () => client as never, { fetch: fetch as never, output })).rejects.toThrow(UsageError);
    expect(client.webhookEndpoint.sendTestEvent).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an unknown event type', async () => {
    const { output, fetch } = fakeDeps();
    await expect(trigger('nope.event', {}, noClient, { fetch: fetch as never, output })).rejects.toThrow(UsageError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an unknown event type even with --forward-to, and never calls fetch', async () => {
    const { output, fetch } = fakeDeps();
    await expect(
      trigger('nope.event', { forwardTo: 'http://localhost:3000/wh', secret }, noClient, { fetch: fetch as never, output }),
    ).rejects.toThrow(UsageError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a --forward-to that is not http(s), like tail does, and never calls fetch or constructs a client', async () => {
    const { output, fetch } = fakeDeps();
    await expect(
      trigger('order.paid', { forwardTo: 'not-a-url', secret }, noClient, { fetch: fetch as never, output }),
    ).rejects.toThrow(UsageError);
    expect(fetch).not.toHaveBeenCalled();
  });

  // C5
  describe('loopback restriction', () => {
    it('rejects a non-loopback --forward-to by default, and never calls fetch', async () => {
      const { output, fetch } = fakeDeps();
      await expect(
        trigger('order.paid', { forwardTo: 'https://attacker.example/wh', secret }, noClient, { fetch: fetch as never, output }),
      ).rejects.toThrow(/loopback|--allow-remote/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('accepts a non-loopback --forward-to when --allow-remote is set', async () => {
      const { output, fetch, lines } = fakeDeps();
      await trigger(
        'order.paid',
        { forwardTo: 'https://attacker.example/wh', secret, allowRemote: true },
        noClient,
        { fetch: fetch as never, output },
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(lines).toEqual(['→ 200 order.paid (local sample)']);
    });

    it('still accepts loopback URLs (127.0.0.0/8, [::1]) with no --allow-remote', async () => {
      const { output, fetch } = fakeDeps();
      await trigger('order.paid', { forwardTo: 'http://127.0.0.1:4000/wh', secret }, noClient, { fetch: fetch as never, output });
      await trigger('order.paid', { forwardTo: 'http://[::1]:4000/wh', secret }, noClient, { fetch: fetch as never, output });
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  // C5
  it('warns on stderr when the signing secret came from the environment, and still forwards', async () => {
    const { output, fetch, lines } = fakeDeps();
    await trigger(
      'order.paid',
      { forwardTo: 'http://localhost:3000/wh', secret, secretFromEnv: true },
      noClient,
      { fetch: fetch as never, output },
    );
    expect(lines.some((l) => /warning/i.test(l) && /env/i.test(l))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never warns when the secret came from --secret', async () => {
    const { output, fetch, lines } = fakeDeps();
    await trigger(
      'order.paid',
      { forwardTo: 'http://localhost:3000/wh', secret, secretFromEnv: false },
      noClient,
      { fetch: fetch as never, output },
    );
    expect(lines.some((l) => /warning/i.test(l))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // B10
  it('throws (exit 1 at the main() level) when the local endpoint answers non-2xx', async () => {
    const { output, lines } = fakeDeps();
    const fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      trigger('order.paid', { forwardTo: 'http://localhost:3000/wh', secret }, noClient, { fetch: fetch as never, output }),
    ).rejects.toThrow(/500/);
    // The status line is still printed before the failure is raised.
    expect(lines).toEqual(['→ 500 order.paid (local sample)']);
  });

  // C5 fix round 1: a redirect must not be followed off-host.
  it('passes redirect: manual to the forward fetch, and treats a redirect as a failure', async () => {
    const { output, lines } = fakeDeps();
    const fetch = vi.fn(async () => new Response(null, { status: 307 }));
    await expect(
      trigger('order.paid', { forwardTo: 'http://localhost:3000/wh', secret }, noClient, { fetch: fetch as never, output }),
    ).rejects.toThrow(/307/);
    const [, init] = fetch.mock.calls[0]!;
    expect((init as RequestInit).redirect).toBe('manual');
    expect(lines).toEqual(['→ 307 order.paid (local sample)']);
  });

  it('does not throw when the local endpoint answers any 2xx', async () => {
    const { output } = fakeDeps();
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      trigger('order.paid', { forwardTo: 'http://localhost:3000/wh', secret }, noClient, { fetch: fetch as never, output }),
    ).resolves.toBeUndefined();
  });

  // A handler deduping on event.id must see a fresh id on every trigger, or it silently drops
  // every delivery after the first.
  it('sends a fresh evt_<32 hex> id on every trigger, never the sample default', async () => {
    const { output, fetch } = fakeDeps();
    await trigger('order.paid', { forwardTo: 'http://localhost:3000/wh', secret }, noClient, { fetch: fetch as never, output });
    await trigger('order.paid', { forwardTo: 'http://localhost:3000/wh', secret }, noClient, { fetch: fetch as never, output });
    const ids = fetch.mock.calls.map(([, init]) => (JSON.parse((init as RequestInit).body as string) as { id: string }).id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).not.toBe(`evt_${'0'.repeat(31)}1`);
  });
});
