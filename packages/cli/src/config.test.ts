import { describe, expect, it } from 'vitest';
import { UsageError, webhookSecretFrom } from './config.js';

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
