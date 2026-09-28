import { describe, expect, it, vi } from 'vitest';
import { UsageError } from '../config.js';
import { eventsTail } from './events-tail.js';

const at = (m: number) => new Date(Date.parse('2026-09-28T10:00:00Z') + m * 60_000).toISOString();
const ev = (id: string, minute: number) => ({ id, object: 'event', type: 'order.paid', timestamp: at(minute), data: {} });
const secret = 'whsec_' + Buffer.alloc(32, 1).toString('base64');

// Abort is fired from `sleep` — called only after a poll's whole batch has already forwarded —
// never from inside `list()`. Aborting mid-poll (before/during forwarding) is exactly what the
// dedicated Ctrl-C tests below exercise; the shared tests here just want the given `pages` fully
// delivered.
function setup(pages: Array<{ items: ReturnType<typeof ev>[] }>) {
  const controller = new AbortController();
  const posted: string[] = [];
  let exhausted = false;
  const client = { events: { list: vi.fn(async () => { const next = pages.shift(); if (!pages.length) exhausted = true; return { next_cursor: null, ...next }; }) } };
  const fetch = vi.fn(async (_url: string, init: RequestInit) => { posted.push(JSON.parse(init.body as string).id); return new Response('ok', { status: 200 }); });
  const lines: string[] = [];
  return {
    run: () => eventsTail(client as never, { forwardTo: 'http://localhost:3000/wh', secret, sinceMs: 5 * 60_000, intervalMs: 2000 }, {
      fetch: fetch as never, now: () => Date.parse(at(10)), sleep: async () => { if (exhausted) controller.abort(); }, signal: controller.signal,
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
    let exhausted = false;
    const client = { events: { list: vi.fn(async () => { const next = pages.shift(); if (!pages.length) exhausted = true; return { next_cursor: null, ...next }; }) } };
    const fetch = vi.fn(async (_url: string, init: RequestInit) => { posted.push(JSON.parse(init.body as string).id); return new Response('ok', { status: 200 }); });
    await eventsTail(client as never, { forwardTo: 'http://localhost:3000/wh', secret, sinceMs: 1e15, intervalMs: 2000 }, {
      fetch: fetch as never, now: () => Date.parse(at(20_000)), sleep: async () => { if (exhausted) controller.abort(); }, signal: controller.signal,
      output: { out: () => {}, err: () => {} },
    });
    expect(posted.filter((id) => id === 'evt_bulk_00000')).toHaveLength(2);
  });
});

// A6
it('forwards the delivery envelope only (id, type, timestamp, data), dropping object', async () => {
  const { run, fetch } = setup([{ items: [ev('evt_x', 8)] }]);
  await run();
  const [, init] = fetch.mock.calls[0]!;
  const sent = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(['data', 'id', 'timestamp', 'type']);
  expect(sent).not.toHaveProperty('object');
});

// A6
it('follows next_cursor across pages within one poll when more than 100 events are new, forwarding oldest first overall', async () => {
  const controller = new AbortController();
  const posted: string[] = [];
  let exhausted = false;
  const list = vi.fn(async ({ cursor }: { cursor?: string }) => {
    if (!cursor) return { items: [ev('evt_b', 7), ev('evt_a', 6)], next_cursor: 'p2' };
    exhausted = true;
    return { items: [ev('evt_c', 5)], next_cursor: null };
  });
  const client = { events: { list } };
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    posted.push(JSON.parse(init.body as string).id);
    return new Response('ok', { status: 200 });
  });
  await eventsTail(
    client as never,
    { forwardTo: 'http://localhost:3000/wh', secret, sinceMs: 5 * 60_000, intervalMs: 2000 },
    {
      fetch: fetch as never,
      now: () => Date.parse(at(10)),
      sleep: async () => { if (exhausted) controller.abort(); },
      signal: controller.signal,
      output: { out: () => {}, err: () => {} },
    },
  );
  expect(list).toHaveBeenCalledTimes(2);
  expect(list.mock.calls[1]![0]).toMatchObject({ cursor: 'p2' });
  expect(posted).toEqual(['evt_c', 'evt_a', 'evt_b']);
});

// A6
it('stops following next_cursor once a page adds nothing new, even if the API offers more pages', async () => {
  const controller = new AbortController();
  const list = vi.fn(async () =>
    // Older than --since (5m before now=at(10), so threshold is at(5)); every item here is
    // filtered out, so paging must stop despite a non-null next_cursor.
    ({ items: [ev('evt_old', 0)], next_cursor: 'more' }),
  );
  const client = { events: { list } };
  const fetch = vi.fn();
  await eventsTail(
    client as never,
    { forwardTo: 'http://localhost:3000/wh', secret, sinceMs: 5 * 60_000, intervalMs: 2000 },
    { fetch: fetch as never, now: () => Date.parse(at(10)), sleep: async () => { controller.abort(); }, signal: controller.signal, output: { out: () => {}, err: () => {} } },
  );
  expect(list).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

// C16/A6 fix round 1: a next_cursor that never actually advances the underlying page (a stuck
// or buggy cursor) must not page forever or grow `candidates` without bound — local dedup within
// the poll stops it as soon as a "page" adds nothing genuinely new.
it('stops paging when next_cursor is stuck and keeps returning the same events', async () => {
  const controller = new AbortController();
  const posted: string[] = [];
  let calls = 0;
  const list = vi.fn(async () => {
    calls += 1;
    if (calls > 25) controller.abort(); // safety net: fail the test loudly instead of hanging
    // Always the same page, with a next_cursor that "advances" in name only.
    return { items: [ev('evt_a', 6), ev('evt_b', 7)], next_cursor: 'stuck' };
  });
  const client = { events: { list } };
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    posted.push(JSON.parse(init.body as string).id);
    return new Response('ok', { status: 200 });
  });
  await eventsTail(
    client as never,
    { forwardTo: 'http://localhost:3000/wh', secret, sinceMs: 5 * 60_000, intervalMs: 2000 },
    { fetch: fetch as never, now: () => Date.parse(at(10)), sleep: async () => { controller.abort(); }, signal: controller.signal, output: { out: () => {}, err: () => {} } },
  );
  // Two calls: the first page yields evt_a/evt_b (fresh), the identical second page yields
  // nothing new (both already gathered this poll) and paging stops there.
  expect(list).toHaveBeenCalledTimes(2);
  expect(posted).toEqual(['evt_a', 'evt_b']);
});

// Ctrl-C: forwards run strictly sequentially and are never preempted mid-flight (nothing can
// interrupt an `await`), so whichever one is already in progress when the signal aborts still
// completes — but the forward loop rechecks the signal before starting the next one, so nothing
// else already gathered for that poll's batch goes out afterward (`bin.ts` turns this into exit
// code 130).
it('finishes only the forward already in flight once the signal aborts mid-batch, forwarding no more that poll', async () => {
  const controller = new AbortController();
  const posted: string[] = [];
  const client = { events: { list: vi.fn(async () => ({ next_cursor: null, items: [ev('evt_a', 6), ev('evt_b', 7)] })) } };
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    posted.push(JSON.parse(init.body as string).id);
    controller.abort(); // simulate Ctrl-C firing while the first forward is in flight
    return new Response('ok', { status: 200 });
  });
  await eventsTail(
    client as never,
    { forwardTo: 'http://localhost:3000/wh', secret, sinceMs: 5 * 60_000, intervalMs: 2000 },
    { fetch: fetch as never, now: () => Date.parse(at(10)), sleep: async () => {}, signal: controller.signal, output: { out: () => {}, err: () => {} } },
  );
  expect(posted).toEqual(['evt_a']);
});

it('logs a failed poll and keeps polling after the interval', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = { events: { list: vi.fn(async () => {
    calls += 1;
    if (calls === 1) throw new Error('503 upstream');
    return { next_cursor: null, items: [ev('evt_z', 9)] };
  }) } };
  const posted: string[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => { posted.push(JSON.parse(init.body as string).id); return new Response('ok'); });
  // Aborts only after the second (successful) poll's batch has already forwarded — never from
  // inside list() — so evt_z's forward isn't skipped by the Ctrl-C-aware forward loop.
  const sleep = vi.fn(async () => { if (calls >= 2) controller.abort(); });
  const lines: string[] = [];
  await eventsTail(client as never, { forwardTo: 'http://localhost:3000/wh', secret, sinceMs: 5 * 60_000, intervalMs: 2000 }, {
    fetch: fetch as never, now: () => Date.parse(at(10)), sleep, signal: controller.signal,
    output: { out: (l) => lines.push(l), err: (l) => lines.push(l) },
  });
  expect(lines).toContain('✗ poll failed: 503 upstream');
  expect(sleep).toHaveBeenCalledWith(2000, controller.signal);
  expect(posted).toEqual(['evt_z']);
});
