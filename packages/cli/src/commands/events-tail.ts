import type { Fianto, FiantoEvent } from '@fianto/sdk';
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

/** What fianto actually delivers: `id`, `type`, `timestamp`, `data` — `object` is list/retrieve-only (A6). */
function toDeliveryEnvelope(event: FiantoEvent): { id: string; type: string; timestamp: string; data: unknown } {
  return { id: event.id, type: event.type, timestamp: event.timestamp, data: event.data };
}

async function forwardEvent(
  event: FiantoEvent,
  secret: string,
  forwardTo: string,
  deps: Pick<Deps, 'fetch' | 'now' | 'output'>,
): Promise<void> {
  const { body, headers } = await signWebhook({ event: toDeliveryEnvelope(event), secret });
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
 * Runs until `deps.signal` aborts (Ctrl-C in the CLI, see `bin.ts`). Since one poll can gather far
 * more than one page (A6 follows `next_cursor` until it catches up — with a wide `--since`, that
 * can be thousands of events), the forward loop rechecks the signal before each event: whichever
 * forward is already in flight when Ctrl-C lands always finishes (forwards are sequential, never
 * concurrent — nothing preempts an `await` mid-flight), but nothing already-gathered-but-not-yet-
 * sent from that same batch goes out afterward. `bin.ts` then exits 130; a second Ctrl-C exits
 * immediately instead of waiting for that. At-most-once per process: a crash or restart
 * re-forwards nothing already delivered and may miss events during the gap — this is a dev
 * convenience, not a delivery guarantee.
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
    const candidates: FiantoEvent[] = [];
    // Scoped to this poll only: `seen` (forwarded-ever) isn't updated until a candidate actually
    // forwards, below, so without this a page that keeps returning the same items — e.g. a
    // next_cursor that never actually advances — would look "fresh" forever and this poll would
    // never stop paging or stop growing `candidates`.
    const gathered = new Set<string>();
    let cursor: string | undefined;
    let pollFailed = false;

    // v1/events pages newest-first. Keep following next_cursor while a page still adds events
    // this poll hasn't forwarded yet, so a burst bigger than one page (100 events) is never
    // silently dropped (A6). Stop as soon as a page adds nothing new — everything past it is
    // guaranteed either already forwarded, already gathered this poll, or older than --since —
    // or the pages run out.
    for (;;) {
      let page: Awaited<ReturnType<Fianto['events']['list']>>;
      try {
        page = await client.events.list({ limit: 100, type: options.type, cursor });
      } catch (error) {
        // A transient API or network failure must not end the tail: log it and poll again later.
        const message = error instanceof Error ? error.message : String(error);
        deps.output.out(`✗ poll failed: ${message}`);
        pollFailed = true;
        break;
      }
      const fresh = page.items.filter(
        (event) => !seen.has(event.id) && !gathered.has(event.id) && Date.parse(event.timestamp) >= threshold,
      );
      for (const event of fresh) gathered.add(event.id);
      candidates.push(...fresh);
      if (fresh.length === 0 || page.next_cursor === null || page.items.length === 0) break;
      cursor = page.next_cursor;
    }

    if (!pollFailed) {
      candidates.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      for (const event of candidates) {
        // Ctrl-C: forwards are sequential, so whichever one is already in flight always
        // finishes, but nothing else already gathered for this poll goes out after that.
        if (deps.signal?.aborted) break;
        await forwardEvent(event, options.secret, options.forwardTo, deps);
        remember(seen, event.id);
      }
    }

    await deps.sleep(options.intervalMs, deps.signal);
  }
}
