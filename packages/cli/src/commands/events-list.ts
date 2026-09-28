import type { Fianto } from '@fianto/sdk';
import type { Output } from '../output.js';

/** One page of `GET v1/events`, newest first (the API's own order). */
export async function eventsList(
  client: Fianto,
  options: { type?: string; limit: number },
  output: Output,
): Promise<void> {
  const page = await client.events.list({ type: options.type, limit: options.limit });
  for (const event of page.items) {
    output.out(`${event.id}  ${event.timestamp}  ${event.type}`);
  }
}
