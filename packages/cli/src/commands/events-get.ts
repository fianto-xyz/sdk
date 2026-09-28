import type { Fianto } from '@fianto/sdk';
import type { Output } from '../output.js';

/** `GET v1/events/:id`, pretty-printed. */
export async function eventsGet(client: Fianto, id: string, output: Output): Promise<void> {
  const event = await client.events.retrieve(id);
  output.out(JSON.stringify(event, null, 2));
}
