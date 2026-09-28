import { parseArgs } from 'node:util';
import { APIError, FiantoError, type Fianto } from '@fianto/sdk';
import { eventsGet } from './commands/events-get.js';
import { eventsList } from './commands/events-list.js';
import { whoami } from './commands/whoami.js';
import { credentialsFrom, UsageError, type CliCredentials } from './config.js';
import type { Output } from './output.js';

export interface Deps {
  output: Output;
  env: NodeJS.ProcessEnv;
  makeClient(c: CliCredentials): Fianto;
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  signal?: AbortSignal;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Commands not yet implemented (events tail, trigger, sign — Task 3) are listed here so
// `--help`/`help` describes the full surface, but are not dispatched: calling one today falls
// through to the "Unknown command" usage error below, same as any other unrecognised command.
const USAGE = `Usage: fianto <command> [options]

Commands:
  whoami                                      application, merchant and webhook status
  events list [--type <type>] [--limit <n>]   list recent events (limit default 20, max 100)
  events get <evt_id>                         print one event as JSON
  events tail --forward-to <url> [--secret <whsec_>] [--since <duration>] [--type <type>] [--interval <ms>]
                                               forward live events to a local URL (not yet implemented)
  trigger <type> [--forward-to <url>] [--secret <whsec_>]
                                               send a signed sample event to a local URL (not yet implemented)
  sign --payload <file> [--secret <whsec_>] [--id <id>] [--timestamp <unix>]
                                               print signed webhook headers for a payload (not yet implemented)
  help                                        show this help

Global flags:
  --app-id <id>          overrides FIANTO_APP_ID
  --app-secret <secret>  overrides FIANTO_APP_SECRET
  --base-url <url>       overrides FIANTO_BASE_URL
  --help                 show this help`;

const OPTIONS = {
  'app-id': { type: 'string' },
  'app-secret': { type: 'string' },
  'base-url': { type: 'string' },
  help: { type: 'boolean' },
  type: { type: 'string' },
  limit: { type: 'string' },
  'forward-to': { type: 'string' },
  secret: { type: 'string' },
  since: { type: 'string' },
  interval: { type: 'string' },
  payload: { type: 'string' },
  id: { type: 'string' },
  timestamp: { type: 'string' },
} as const;

export async function main(argv: string[], deps: Deps): Promise<number> {
  let parsed: { values: { [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K]['type'] extends 'boolean' ? boolean : string }; positionals: string[] };
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    return usageFail(deps, error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;

  if (values.help || positionals.length === 0 || positionals[0] === 'help') {
    deps.output.out(USAGE);
    return 0;
  }

  const [command, ...rest] = positionals;

  try {
    switch (command) {
      case 'whoami': {
        const client = deps.makeClient(credentialsFrom(values, deps.env));
        await whoami(client, deps.output);
        return 0;
      }
      case 'events':
        return await dispatchEvents(rest, values, deps);
      default:
        throw new UsageError(`Unknown command: ${command}`);
    }
  } catch (error) {
    return handleError(deps, error);
  }
}

async function dispatchEvents(
  rest: string[],
  values: { type?: string; limit?: string; 'app-id'?: string; 'app-secret'?: string; 'base-url'?: string },
  deps: Deps,
): Promise<number> {
  const [sub, ...subRest] = rest;
  if (sub === 'list') {
    const limit = parseLimit(values.limit);
    const client = deps.makeClient(credentialsFrom(values, deps.env));
    await eventsList(client, { type: values.type, limit }, deps.output);
    return 0;
  }
  if (sub === 'get') {
    const id = subRest[0];
    if (!id) throw new UsageError('events get requires an event id, e.g. fianto events get evt_123');
    const client = deps.makeClient(credentialsFrom(values, deps.env));
    await eventsGet(client, id, deps.output);
    return 0;
  }
  throw new UsageError(`Unknown command: events ${sub ?? ''}`.trimEnd());
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new UsageError(`Invalid --limit (${raw}): expected an integer from 1 to ${MAX_LIMIT}.`);
  }
  return value;
}

function handleError(deps: Deps, error: unknown): number {
  if (error instanceof UsageError) return usageFail(deps, error.message);
  if (error instanceof APIError) {
    deps.output.err(`${error.code}: ${error.message} (request ${error.requestId ?? 'unknown'})`);
    return 1;
  }
  if (error instanceof FiantoError) {
    deps.output.err(error.message);
    return 1;
  }
  deps.output.err(error instanceof Error ? error.message : String(error));
  return 1;
}

function usageFail(deps: Deps, message: string): number {
  deps.output.err(message);
  deps.output.err(USAGE);
  return 2;
}
