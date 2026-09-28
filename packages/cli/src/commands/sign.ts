import { readFile } from 'node:fs/promises';
import { signWebhook } from '@fianto/sdk/webhooks';
import { UsageError } from '../config.js';
import type { Output } from '../output.js';

export interface SignInput {
  /** Path to a JSON file holding the event to sign. */
  payload: string;
  secret: string;
  /** Default: the payload's own `id`, else a fresh `evt_` id. */
  id?: string;
  /** Unix seconds. Default: now. */
  timestamp?: number;
}

/**
 * Reads a JSON event from `payload`, signs it exactly as fianto would, and prints the signed
 * body followed by a ready `curl` command a developer can paste (with `$URL` left for them to
 * set). The signature covers the file's exact bytes, which is what curl sends. Never prints the secret itself.
 */
export async function sign(options: SignInput, output: Output): Promise<void> {
  const raw = await readFile(options.payload, 'utf8');
  let event: object;
  try {
    event = JSON.parse(raw) as object;
  } catch {
    throw new UsageError(`Invalid JSON in payload file: ${options.payload}`);
  }
  const { body, headers } = await signWebhook({
    event,
    rawBody: raw,
    secret: options.secret,
    id: options.id,
    timestamp: options.timestamp,
  });

  output.out(body);
  output.out(
    [
      'curl -X POST "$URL"',
      `-H ${shellQuote('content-type: application/json')}`,
      `-H ${shellQuote(`webhook-id: ${headers['webhook-id']}`)}`,
      `-H ${shellQuote(`webhook-timestamp: ${headers['webhook-timestamp']}`)}`,
      `-H ${shellQuote(`webhook-signature: ${headers['webhook-signature']}`)}`,
      `--data-binary ${shellQuote(`@${options.payload}`)}`,
    ].join(' '),
  );
}

/**
 * Single-quotes a value for a POSIX shell, escaping embedded single quotes (`'\''`). Every
 * interpolated value in the printed `curl` command goes through this — an id containing `'`,
 * `$(...)`, spaces or a newline stays inert text inside the quotes instead of breaking out (C4).
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
