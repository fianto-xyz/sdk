import { buttonText, errorTextKey, STATUS_TEXT } from './labels.js';
import type { ButtonLocale, StatusTextKey } from './labels.js';

const LOCALES: ButtonLocale[] = ['en', 'vi'];

it('gives every StatusTextKey a non-empty line in every locale', () => {
  const keys = Object.keys(STATUS_TEXT.en) as StatusTextKey[];
  for (const locale of LOCALES) {
    for (const key of keys) {
      expect(STATUS_TEXT[locale][key]).toBeTruthy();
    }
  }
});

it('maps order_session_mismatch to a dedicated key, never generic "try again"', () => {
  expect(errorTextKey('order_session_mismatch')).toBe('mismatch');
  expect(STATUS_TEXT.en.mismatch).not.toBe(STATUS_TEXT.en.generic);
  // Retrying with the same terms can't succeed — the copy must say to reload, not just retry.
  expect(STATUS_TEXT.en.mismatch.toLowerCase()).toContain('reload');
});

it('maps plan_limit_reached to a dedicated, neutral key that never promises a retry will work', () => {
  expect(errorTextKey('plan_limit_reached')).toBe('unavailable');
  expect(STATUS_TEXT.en.unavailable).not.toBe(STATUS_TEXT.en.generic);
  expect(STATUS_TEXT.en.unavailable.toLowerCase()).not.toContain('try again');
});

// S1/S5/S3: codes a retry with the same params can never fix get the neutral line, not "try again".
it.each(['order_id_in_use', 'price_ended', 'product_ended', 'subscriptions_paused'])('maps %s to unavailable', (code) => {
  expect(errorTextKey(code)).toBe('unavailable');
});

it.each(['checkout_busy', 'service_busy'])('maps the transient %s to busy', (code) => {
  expect(errorTextKey(code)).toBe('busy');
});

it('never says a payment is being processed when one may only be possible (S15)', () => {
  expect(STATUS_TEXT.en.payment_in_progress).toBe('A payment for this order may already be in progress.');
});

it('falls back to generic for an unknown or missing error code', () => {
  expect(errorTextKey('some_new_code_this_sdk_does_not_know')).toBe('generic');
  expect(errorTextKey(undefined)).toBe('generic');
});

it('still maps the other known codes to their existing keys', () => {
  expect(errorTextKey('payment_in_progress')).toBe('payment_in_progress');
  expect(errorTextKey('order_already_paid')).toBe('already_paid');
  expect(errorTextKey('checkout_unavailable')).toBe('busy');
  expect(errorTextKey('rate_limited')).toBe('busy');
  expect(errorTextKey('session_not_reissuable')).toBe('busy');
  expect(errorTextKey('subscription_preparing')).toBe('busy');
});

it('builds button text with a locale-specific prefix and an aria-label carrying "fianto"', () => {
  expect(buttonText('pay', 'en')).toEqual({ prefix: 'Pay with', ariaLabel: 'Pay with fianto' });
  expect(buttonText('plain', 'en')).toEqual({ prefix: '', ariaLabel: 'fianto' });
});
