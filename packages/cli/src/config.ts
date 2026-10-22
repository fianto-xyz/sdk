import { readFile } from 'node:fs/promises';
import type { Network } from '@fianto/sdk';

/** A bad flag, a missing flag/env var, or an unknown command: exits 2 with usage on stderr. */
export class UsageError extends Error {
  override name = 'UsageError';
}

export interface CliCredentials {
  appId: string;
  appSecret: string;
  /** Undefined when neither `--base-url` nor `FIANTO_BASE_URL` is set: the SDK's own default applies. */
  baseUrl: string | undefined;
  /** Undefined when neither `--network` nor `FIANTO_NETWORK` is set: the SDK's own default (mainnet) applies. */
  network: Network | undefined;
}

function required(value: string | undefined, flag: string, variable: string): string {
  if (!value) throw new UsageError(`Missing ${flag}: pass ${flag} or set ${variable}.`);
  return value;
}

const NETWORKS: readonly Network[] = ['mainnet', 'devnet'];

function networkFrom(flag: string | undefined, env: string | undefined): Network | undefined {
  // An explicit `--network ''` is a usage mistake to report, never a silent fall-through to the env.
  const [raw, source] = flag !== undefined ? [flag, '--network'] : [env, 'FIANTO_NETWORK'];
  if (raw === undefined || (source === 'FIANTO_NETWORK' && raw === '')) return undefined;
  if ((NETWORKS as readonly string[]).includes(raw)) return raw as Network;
  throw new UsageError(`Invalid ${source} (${raw}): expected mainnet or devnet.`);
}

/** Flags win over env. Throws `UsageError` naming the missing flag/env var. */
export function credentialsFrom(
  flags: { 'app-id'?: string; 'app-secret'?: string; 'base-url'?: string; network?: string },
  env: NodeJS.ProcessEnv,
): CliCredentials {
  return {
    appId: required(flags['app-id'] ?? env.FIANTO_APP_ID, '--app-id', 'FIANTO_APP_ID'),
    appSecret: required(flags['app-secret'] ?? env.FIANTO_APP_SECRET, '--app-secret', 'FIANTO_APP_SECRET'),
    baseUrl: flags['base-url'] ?? env.FIANTO_BASE_URL,
    network: networkFrom(flags.network, env.FIANTO_NETWORK),
  };
}

export interface WebhookSecret {
  secret: string;
  /** True when neither `--secret` nor `--secret-file` was given, so `FIANTO_WEBHOOK_SECRET` supplied it. */
  fromEnv: boolean;
}

/**
 * `--secret` wins, then `--secret-file <path>` (read as UTF-8, trimmed), then
 * `FIANTO_WEBHOOK_SECRET`. Throws `UsageError` naming all three when none is set, or when
 * `--secret-file` can't be read or is empty after trimming.
 */
export async function webhookSecretFrom(
  flags: { secret?: string; 'secret-file'?: string },
  env: NodeJS.ProcessEnv,
): Promise<WebhookSecret> {
  // `flags.secret !== undefined` distinguishes "--secret was not passed" from "--secret ''":
  // an explicit empty value is a usage mistake to report, never a silent fall-through to
  // --secret-file or FIANTO_WEBHOOK_SECRET as though --secret had never been given.
  if (flags.secret !== undefined) {
    if (!flags.secret) throw new UsageError('--secret must not be empty.');
    return { secret: flags.secret, fromEnv: false };
  }
  if (flags['secret-file']) {
    const path = flags['secret-file'];
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      throw new UsageError(`Could not read --secret-file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const secret = raw.trim();
    if (!secret) throw new UsageError(`--secret-file ${path} is empty.`);
    return { secret, fromEnv: false };
  }
  if (env.FIANTO_WEBHOOK_SECRET) return { secret: env.FIANTO_WEBHOOK_SECRET, fromEnv: true };
  throw new UsageError('Missing --secret: pass --secret, --secret-file <path>, or set FIANTO_WEBHOOK_SECRET.');
}
