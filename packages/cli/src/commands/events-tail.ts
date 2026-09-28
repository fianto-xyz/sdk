import type { Event, Fianto } from '@fianto/sdk';
import { signWebhook } from '@fianto/sdk/webhooks';
import { UsageError } from '../config.js';
import { formatDuration } from '../duration.js';
import type { Deps } from '../main.js';

export interface TailOptions {
  forwardTo: string;
  secret: string;
  sinceMs: number;
  type?: string;
  intervalMs: number;
}

/** Forwarded ids are kept for dedup up to this many; the oldest is dropped first. */
const MAX_SEEN = 10_000;

function remember(seen: Set<string>, id: string): void {
  seen.add(id);
  if (seen.size > MAX_SEEN) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

async function forwardEvent(
  event: Event,
  secret: string,
  forwardTo: string,
  deps: Pick<Deps, 'fetch' | 'now' | 'output'>,
): Promise<void> {
  const { body, headers } = await signWebhook({ event, secret });
  const startedAt = deps.now();
  try {
    const response = await deps.fetch(forwardTo, { method: 'POST', headers, body });
    const elapsedMs = deps.now() - startedAt;
    deps.output.out(`→ ${response.status} ${event.type} ${event.id} ${elapsedMs}ms`);
  } catch (error) {
    // A dropped connection or refused socket: the local dev server isn't up (yet). Keep polling —
    // this is a convenience relay for local development, not a delivery guarantee, so a failed
    // forward is logged and the event is still marked seen rather than retried forever.
    const message = error instanceof Error ? error.message : String(error);
    deps.output.out(`✗ ${event.type} ${event.id} ${message}`);
  }
}

/**
 * Polls `GET v1/events` and forwards new events to a local URL, signed as fianto would sign them.
 * Runs until `deps.signal` aborts (Ctrl-C in the CLI). At-most-once per process: a crash or
 * restart re-forwards nothing already delivered and may miss events during the gap — this is a
 * dev convenience, not a delivery guarantee.
 */
export async function eventsTail(
  client: Fianto,
  options: TailOptions,
  deps: Pick<Deps, 'fetch' | 'now' | 'sleep' | 'output' | 'signal'>,
): Promise<void> {
  if (!/^https?:\/\//.test(options.forwardTo)) {
    throw new UsageError(`--forward-to must be an http:// or https:// URL, got: ${options.forwardTo}`);
  }

  const startedAt = deps.now();
  const threshold = startedAt - options.sinceMs;
  const seen = new Set<string>();

  deps.output.out(
    `Forwarding events from the last ${formatDuration(options.sinceMs)} to ${options.forwardTo} (Ctrl-C to stop)`,
  );

  while (!deps.signal?.aborted) {
    let page: Awaited<ReturnType<Fianto['events']['list']>>;
    try {
      page = await client.events.list({ limit: 100, type: options.type });
    } catch (error) {
      // A transient API or network failure must not end the tail: log it and poll again later.
      const message = error instanceof Error ? error.message : String(error);
      deps.output.out(`✗ poll failed: ${message}`);
      await deps.sleep(options.intervalMs, deps.signal);
      continue;
    }
    const candidates = page.items
      .filter((event) => !seen.has(event.id) && Date.parse(event.timestamp) >= threshold)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    for (const event of candidates) {
      await forwardEvent(event, options.secret, options.forwardTo, deps);
      remember(seen, event.id);
    }

    await deps.sleep(options.intervalMs, deps.signal);
  }
}
