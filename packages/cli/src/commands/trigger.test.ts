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
});
