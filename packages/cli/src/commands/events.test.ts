import { describe, expect, it, vi } from 'vitest';
import { main, type Deps } from '../main.js';
import type { Output } from '../output.js';
import { eventsGet } from './events-get.js';
import { eventsList } from './events-list.js';

function fakeOutput(): { output: Output; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { output: { out: (l) => lines.push(l), err: (l) => errors.push(l) }, lines, errors };
}

const SAMPLE_EVENT = {
  id: 'evt_x',
  object: 'event' as const,
  type: 'order.paid',
  timestamp: '2026-09-28T00:00:00Z',
  data: { order_id: 'ord_1' },
};

describe('eventsList', () => {
  it('calls events.list with the given filters and prints one line per event, newest first', async () => {
    const { output, lines } = fakeOutput();
    const client = {
      events: {
        list: vi.fn(async () => ({
          items: [
            { id: 'evt_2', object: 'event' as const, type: 'order.paid', timestamp: '2026-09-28T00:00:01Z', data: {} },
            { id: 'evt_1', object: 'event' as const, type: 'order.paid', timestamp: '2026-09-28T00:00:00Z', data: {} },
          ],
          next_cursor: null,
        })),
      },
    };
    await eventsList(client as never, { type: 'order.paid', limit: 5 }, output);
    expect(client.events.list).toHaveBeenCalledWith({ type: 'order.paid', limit: 5 });
    expect(lines).toEqual([
      'evt_2  2026-09-28T00:00:01Z  order.paid',
      'evt_1  2026-09-28T00:00:00Z  order.paid',
    ]);
  });
});

describe('eventsGet', () => {
  it('prints the event as pretty JSON', async () => {
    const { output, lines } = fakeOutput();
    const client = { events: { retrieve: vi.fn(async () => SAMPLE_EVENT) } };
    await eventsGet(client as never, 'evt_x', output);
    expect(client.events.retrieve).toHaveBeenCalledWith('evt_x');
    expect(lines).toEqual([JSON.stringify(SAMPLE_EVENT, null, 2)]);
  });
});

function deps(overrides: Partial<Deps> = {}) {
  const lines: string[] = []; const errors: string[] = [];
  const client = {
    application: { retrieve: vi.fn() },
    events: { list: vi.fn(async () => ({ items: [], next_cursor: null })), retrieve: vi.fn(async () => SAMPLE_EVENT) },
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

describe('events dispatch via main', () => {
  it('rejects a --limit over 100 as a usage error', async () => {
    const { d, errors, client } = deps();
    expect(await main(['events', 'list', '--limit', '500'], d)).toBe(2);
    expect(errors.join('\n')).toMatch(/limit/i);
    expect(client.events.list).not.toHaveBeenCalled();
  });

  it('requires an id for events get', async () => {
    const { d, errors, client } = deps();
    expect(await main(['events', 'get'], d)).toBe(2);
    expect(errors.join('\n')).toContain('Usage: fianto <command> [options]');
    expect(client.events.retrieve).not.toHaveBeenCalled();
  });

  it('prints the event JSON for events get <id>', async () => {
    const { d, lines } = deps();
    expect(await main(['events', 'get', 'evt_x'], d)).toBe(0);
    expect(lines).toEqual([JSON.stringify(SAMPLE_EVENT, null, 2)]);
  });
});
