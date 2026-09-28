/** A bad flag, a missing flag/env var, or an unknown command: exits 2 with usage on stderr. */
export class UsageError extends Error {
  override name = 'UsageError';
}

export interface CliCredentials {
  appId: string;
  appSecret: string;
  baseUrl: string;
}

function required(value: string | undefined, flag: string, variable: string): string {
  if (!value) throw new UsageError(`Missing ${flag}: pass ${flag} or set ${variable}.`);
  return value;
}

/** Flags win over env. Throws `UsageError` naming the missing flag/env var. */
export function credentialsFrom(
  flags: { 'app-id'?: string; 'app-secret'?: string; 'base-url'?: string },
  env: NodeJS.ProcessEnv,
): CliCredentials {
  return {
    appId: required(flags['app-id'] ?? env.FIANTO_APP_ID, '--app-id', 'FIANTO_APP_ID'),
    appSecret: required(flags['app-secret'] ?? env.FIANTO_APP_SECRET, '--app-secret', 'FIANTO_APP_SECRET'),
    baseUrl: required(flags['base-url'] ?? env.FIANTO_BASE_URL, '--base-url', 'FIANTO_BASE_URL'),
  };
}

/** Flags win over env. Throws `UsageError` naming the missing flag/env var. */
export function webhookSecretFrom(flags: { secret?: string }, env: NodeJS.ProcessEnv): string {
  return required(flags.secret ?? env.FIANTO_WEBHOOK_SECRET, '--secret', 'FIANTO_WEBHOOK_SECRET');
}
