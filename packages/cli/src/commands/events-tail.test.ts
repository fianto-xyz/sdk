import { describe, expect, it, vi } from 'vitest';
import { UsageError } from '../config.js';
import { eventsTail } from './events-tail.js';

const at = (m: number) => new Date(Date.parse('2026-09-28T10:00:00Z') + m * 60_000).toISOString();
const ev = (id: string, minute: number) => ({ id, object: 'event', type: 'order.paid', timestamp: at(minute), data: {} });
const secret = 'whsec_' + Buffer.alloc(32, 1).toString('base64');

function setup(pages: Array<{ items: ReturnType<typeof ev>[] }>) {
  const controller = new AbortController();
  const posted: string[] = [];
  const client = { events: { list: vi.fn(async () => { const next = pages.shift(); if (!pages.length) controller.abort(); return { next_cursor: null, ...next }; }) } };
  const fetch = vi.fn(async (_url: string, init: RequestInit) => { posted.push(JSON.parse(init.body as string).id); return new Response('ok', { status: 200 }); });
  const lines: string[] = [];
  return {
    run: () => eventsTail(client as never, { forwardTo: 'http://localhost:3000/wh', secret, sinceMs: 5 * 60_000, intervalMs: 2000 }, {
      fetch: fetch as never, now: () => Date.parse(at(10)), sleep: async () => {}, signal: controller.signal,
      output: { out: (l) => lines.push(l), err: (l) => lines.push(l) },
    }),
    posted, lines, fetch,
  };
}

// Review Focus 1
it('forwards only events newer than --since on start', async () => {
  const { run, posted } = setup([{ items: [ev('evt_c', 9), ev('evt_b', 6), ev('evt_a', 1)] }]);
  await run();
  expect(posted).toEqual(['evt_b', 'evt_c']);
});

// Review Focus 2
it('forwards each event once, oldest first, across polls', async () => {
  const { run, posted } = setup([
    { items: [ev('evt_b', 7), ev('evt_a', 6)] },
    { items: [ev('evt_c', 11), ev('evt_b', 7), ev('evt_a', 6)] },
  ]);
  await run();
  expect(posted).toEqual(['evt_a', 'evt_b', 'evt_c']);
});

it('signs what it forwards so the local handler can verify it', async () => {
  const { verifyWebhook } = await import('@fianto/sdk/webhooks');
  const { run, fetch } = setup([{ items: [ev('evt_x', 8)] }]);
  await run();
  const [, init] = fetch.mock.calls[0]!;
  await expect(verifyWebhook(init.body as string, init.headers as Record<string, string>, { secret })).resolves.toMatchObject({ id: 'evt_x' });
});

it('keeps going when the local server is down', async () => {
  const { run, lines, fetch } = setup([{ items: [ev('evt_y', 8)] }]);
  fetch.mockRejectedValueOnce(new TypeError('connect ECONNREFUSED'));
  await run();
  expect(lines.some((l) => l.startsWith('✗ order.paid evt_y'))).toBe(true);
});

describe('eventsTail extra coverage', () => {
  it('rejects a --forward-to that is not http(s) before ever calling the API', async () => {
    const client = { events: { list: vi.fn() } };
    const controller = new AbortController();
    await expect(
      eventsTail(client as never, { forwardTo: 'not-a-url', secret, sinceMs: 5 * 60_000, intervalMs: 2000 }, {
        fetch: vi.fn() as never, now: () => Date.parse(at(10)), sleep: async () => {}, signal: controller.signal,
        output: { out: () => {}, err: () => {} },
      }),
    ).rejects.toThrow(UsageError);
    expect(client.events.list).not.toHaveBeenCalled();
  });

  it('prints the startup line once with the human --since and the forward URL', async () => {
    const { run, lines } = setup([{ items: [] }]);
    await run();
    expect(lines[0]).toBe('Forwarding events from the last 5m to http://localhost:3000/wh (Ctrl-C to stop)');
  });

  it('bounds the seen set at 10,000 ids, so a duplicate older than that can be forwarded again', async () => {
    const controller = new AbortController();
    const posted: string[] = [];
    const bulk = Array.from({ length: 10_000 }, (_, i) => ev(`evt_bulk_${String(i).padStart(5, '0')}`, i));
    const pages: Array<{ items: ReturnType<typeof ev>[] }> = [
      { items: bulk },
      { items: [ev('evt_new', 10_000)] }, // the 10,001st id seen; evicts the oldest (evt_bulk_00000)
      { items: [bulk[0]!] }, // the evicted id reappears and must be forwarded again
    ];
    const client = { events: { list: vi.fn(async () => { const next = pages.shift(); if (!pages.length) controller.abort(); return { next_cursor: null, ...next }; }) } };
    const fetch = vi.fn(async (_url: string, init: RequestInit) => { posted.push(JSON.parse(init.body as string).id); return new Response('ok', { status: 200 }); });
    await eventsTail(client as never, { forwardTo: 'http://localhost:3000/wh', secret, sinceMs: 1e15, intervalMs: 2000 }, {
      fetch: fetch as never, now: () => Date.parse(at(20_000)), sleep: async () => {}, signal: controller.signal,
      output: { out: () => {}, err: () => {} },
    });
    expect(posted.filter((id) => id === 'evt_bulk_00000')).toHaveLength(2);
  });
});
