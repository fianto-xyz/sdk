import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { credentialsFrom, UsageError, webhookSecretFrom } from './config.js';

describe('credentialsFrom', () => {
  it('leaves baseUrl undefined when neither --base-url nor FIANTO_BASE_URL is set, so the SDK default applies', () => {
    expect(credentialsFrom({ 'app-id': 'a', 'app-secret': 's' }, {})).toEqual({
      appId: 'a',
      appSecret: 's',
      baseUrl: undefined,
    });
  });

  it('reads baseUrl from FIANTO_BASE_URL when no flag is given', () => {
    expect(credentialsFrom({ 'app-id': 'a', 'app-secret': 's' }, { FIANTO_BASE_URL: 'https://env.example.com' }).baseUrl).toBe(
      'https://env.example.com',
    );
  });

  it('prefers --base-url over FIANTO_BASE_URL', () => {
    expect(
      credentialsFrom({ 'app-id': 'a', 'app-secret': 's', 'base-url': 'https://flag.example.com' }, { FIANTO_BASE_URL: 'https://env.example.com' })
        .baseUrl,
    ).toBe('https://flag.example.com');
  });

  it('still requires --app-id/--app-secret', () => {
    expect(() => credentialsFrom({ 'app-secret': 's' }, {})).toThrow(/--app-id|FIANTO_APP_ID/);
    expect(() => credentialsFrom({ 'app-id': 'a' }, {})).toThrow(/--app-secret|FIANTO_APP_SECRET/);
  });
});

describe('webhookSecretFrom', () => {
  it('prefers the --secret flag over the env var', async () => {
    await expect(webhookSecretFrom({ secret: 'whsec_flag' }, { FIANTO_WEBHOOK_SECRET: 'whsec_env' })).resolves.toEqual({
      secret: 'whsec_flag',
      fromEnv: false,
    });
  });

  it('falls back to FIANTO_WEBHOOK_SECRET when no flag is given, and reports it came from the env', async () => {
    await expect(webhookSecretFrom({}, { FIANTO_WEBHOOK_SECRET: 'whsec_env' })).resolves.toEqual({
      secret: 'whsec_env',
      fromEnv: true,
    });
  });

  it('throws a UsageError naming --secret, --secret-file and FIANTO_WEBHOOK_SECRET when none is set', async () => {
    await expect(webhookSecretFrom({}, {})).rejects.toThrow(UsageError);
    await expect(webhookSecretFrom({}, {})).rejects.toThrow(/--secret/);
    await expect(webhookSecretFrom({}, {})).rejects.toThrow(/--secret-file/);
    await expect(webhookSecretFrom({}, {})).rejects.toThrow(/FIANTO_WEBHOOK_SECRET/);
  });

  // An explicit `--secret ''` is a usage mistake, not "--secret wasn't passed" — it must not
  // silently fall through to --secret-file or FIANTO_WEBHOOK_SECRET as though the flag were
  // absent.
  it('rejects an explicit empty --secret instead of falling back to --secret-file or the env', async () => {
    await expect(webhookSecretFrom({ secret: '' }, { FIANTO_WEBHOOK_SECRET: 'whsec_env' })).rejects.toThrow(UsageError);
    await expect(webhookSecretFrom({ secret: '' }, { FIANTO_WEBHOOK_SECRET: 'whsec_env' })).rejects.toThrow(/--secret/);
  });

  it('rejects an explicit empty --secret even alongside a valid --secret-file', async () => {
    await expect(webhookSecretFrom({ secret: '', 'secret-file': '/nonexistent/path' }, {})).rejects.toThrow(UsageError);
  });

  describe('--secret-file', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'fianto-cli-config-secret-file-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('reads and trims the file, and is not reported as coming from the env', async () => {
      const file = join(dir, 'secret.txt');
      writeFileSync(file, '  whsec_from_file  \n');
      await expect(webhookSecretFrom({ 'secret-file': file }, { FIANTO_WEBHOOK_SECRET: 'whsec_env' })).resolves.toEqual({
        secret: 'whsec_from_file',
        fromEnv: false,
      });
    });

    it('is beaten by --secret when both are given', async () => {
      const file = join(dir, 'secret.txt');
      writeFileSync(file, 'whsec_from_file');
      await expect(webhookSecretFrom({ secret: 'whsec_flag', 'secret-file': file }, {})).resolves.toEqual({
        secret: 'whsec_flag',
        fromEnv: false,
      });
    });

    it('rejects an empty (or all-whitespace) file', async () => {
      const file = join(dir, 'empty.txt');
      writeFileSync(file, '   \n');
      await expect(webhookSecretFrom({ 'secret-file': file }, {})).rejects.toThrow(UsageError);
    });

    it('rejects a missing file, naming the path', async () => {
      const missing = join(dir, 'nope.txt');
      const error: unknown = await webhookSecretFrom({ 'secret-file': missing }, {}).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).message).toContain(missing);
    });
  });
});
