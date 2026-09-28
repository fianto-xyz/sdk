import { describe, expect, it } from 'vitest';
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
  it('prefers the --secret flag over the env var', () => {
    expect(webhookSecretFrom({ secret: 'whsec_flag' }, { FIANTO_WEBHOOK_SECRET: 'whsec_env' })).toBe('whsec_flag');
  });

  it('falls back to FIANTO_WEBHOOK_SECRET when no flag is given', () => {
    expect(webhookSecretFrom({}, { FIANTO_WEBHOOK_SECRET: 'whsec_env' })).toBe('whsec_env');
  });

  it('throws a UsageError naming --secret and FIANTO_WEBHOOK_SECRET when neither is set', () => {
    expect(() => webhookSecretFrom({}, {})).toThrow(UsageError);
    expect(() => webhookSecretFrom({}, {})).toThrow(/--secret/);
    expect(() => webhookSecretFrom({}, {})).toThrow(/FIANTO_WEBHOOK_SECRET/);
  });
});
