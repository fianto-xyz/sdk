import { parseArgs } from 'node:util';
import { isAPIError, isFiantoError, type Fianto } from '@fianto/sdk';
import { eventsGet } from './commands/events-get.js';
import { eventsList } from './commands/events-list.js';
import { eventsTail } from './commands/events-tail.js';
import { sign } from './commands/sign.js';
import { trigger } from './commands/trigger.js';
import { whoami } from './commands/whoami.js';
import { credentialsFrom, UsageError, webhookSecretFrom, type CliCredentials } from './config.js';
import { parseDuration } from './duration.js';
import type { Output } from './output.js';
import { VERSION } from './version.js';

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
const DEFAULT_SINCE_MS = 5 * 60_000;
const DEFAULT_INTERVAL_MS = 2000;
const MIN_INTERVAL_MS = 500;

const USAGE = `Usage: fianto <command> [options]

Commands:
  whoami                                      application, merchant and webhook status
  events list [--type <type>] [--limit <n>]   list recent events (limit default 20, max 100)
  events get <evt_id>                         print one event as JSON
  events tail --forward-to <url> [--secret <whsec_>|--secret-file <path>] [--since <duration>] [--type <type>] [--interval <ms>]
                                               forward live events to a local URL (since default 5m,
                                               interval default 2000ms, Ctrl-C to stop)
  trigger <type> [--forward-to <url>] [--secret <whsec_>|--secret-file <path>] [--allow-remote]
                                               send test.event via fianto, or POST a signed local
                                               sample of <type> to --forward-to (loopback only
                                               unless --allow-remote)
  sign --payload <file> [--secret <whsec_>|--secret-file <path>] [--id <id>] [--timestamp <unix>]
                                               print signed webhook headers and a curl command for a payload
  help                                        show this help

Global flags:
  --app-id <id>          overrides FIANTO_APP_ID
  --app-secret <secret>  overrides FIANTO_APP_SECRET
  --base-url <url>       overrides FIANTO_BASE_URL (default https://api.fianto.xyz)
  --version, -v          print the CLI version
  --help                 show this help`;

const OPTIONS = {
  'app-id': { type: 'string' },
  'app-secret': { type: 'string' },
  'base-url': { type: 'string' },
  help: { type: 'boolean' },
  version: { type: 'boolean', short: 'v' },
  type: { type: 'string' },
  limit: { type: 'string' },
  'forward-to': { type: 'string' },
  secret: { type: 'string' },
  'secret-file': { type: 'string' },
  'allow-remote': { type: 'boolean' },
  since: { type: 'string' },
  interval: { type: 'string' },
  payload: { type: 'string' },
  id: { type: 'string' },
  timestamp: { type: 'string' },
} as const;

type Flags = { [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K]['type'] extends 'boolean' ? boolean : string };

export async function main(argv: string[], deps: Deps): Promise<number> {
  let parsed: { values: Flags; positionals: string[] };
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    return usageFail(deps, error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;

  if (values.version) {
    deps.output.out(VERSION);
    return 0;
  }

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
      case 'trigger': {
        const type = rest[0];
        if (!type) throw new UsageError('trigger requires an event type, e.g. fianto trigger test.event');
        const forwardTo = values['forward-to'];
        const secret = forwardTo ? await webhookSecretFrom(values, deps.env) : undefined;
        // Lazy: a --forward-to run makes no API call and must not require app credentials.
        const getClient = () => deps.makeClient(credentialsFrom(values, deps.env));
        await trigger(
          type,
          { forwardTo, secret: secret?.secret, secretFromEnv: secret?.fromEnv, allowRemote: values['allow-remote'] },
          getClient,
          deps,
        );
        return 0;
      }
      case 'sign': {
        const payload = values.payload;
        if (!payload) throw new UsageError('sign requires --payload <file>');
        const secret = await webhookSecretFrom(values, deps.env);
        const timestamp = parseTimestamp(values.timestamp);
        await sign({ payload, secret: secret.secret, id: values.id, timestamp }, deps.output);
        return 0;
      }
      default:
        throw new UsageError(`Unknown command: ${command}`);
    }
  } catch (error) {
    return handleError(deps, error);
  }
}

async function dispatchEvents(rest: string[], values: Flags, deps: Deps): Promise<number> {
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
  if (sub === 'tail') {
    const forwardTo = values['forward-to'];
    if (!forwardTo) throw new UsageError('events tail requires --forward-to <url>');
    const secret = await webhookSecretFrom(values, deps.env);
    const sinceMs = values.since === undefined ? DEFAULT_SINCE_MS : parseDuration(values.since);
    const intervalMs = parseInterval(values.interval);
    const client = deps.makeClient(credentialsFrom(values, deps.env));
    await eventsTail(client, { forwardTo, secret: secret.secret, sinceMs, type: values.type, intervalMs }, deps);
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

function parseInterval(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_INTERVAL_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_INTERVAL_MS) {
    throw new UsageError(`Invalid --interval (${raw}): expected an integer of at least ${MIN_INTERVAL_MS}.`);
  }
  return value;
}

function parseTimestamp(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new UsageError(`Invalid --timestamp (${raw}): expected a non-negative integer of Unix seconds.`);
  }
  return value;
}

function handleError(deps: Deps, error: unknown): number {
  if (error instanceof UsageError) return usageFail(deps, error.message);
  if (isAPIError(error)) {
    deps.output.err(withCause(`${error.code}: ${error.message} (request ${error.requestId ?? 'unknown'})`, error));
    return 1;
  }
  if (isFiantoError(error)) {
    deps.output.err(withCause(error.message, error));
    return 1;
  }
  deps.output.err(withCause(error instanceof Error ? error.message : String(error), error));
  return 1;
}

/** Appends ` (cause: ...)` when `error.cause` is present, so a wrapped error's real reason isn't lost. One line. */
function withCause(message: string, error: unknown): string {
  if (!(error instanceof Error) || error.cause === undefined) return message;
  const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
  return `${message} (cause: ${cause})`;
}

function usageFail(deps: Deps, message: string): number {
  deps.output.err(message);
  deps.output.err(USAGE);
  return 2;
}
