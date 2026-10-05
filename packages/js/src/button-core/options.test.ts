import { buttonText, errorTextKey, resolveButtonOptions, STATUS_TEXT } from './index.js';

it('applies defaults and rejects unknown values', () => {
  expect(resolveButtonOptions({})).toEqual({ theme: 'brand', label: 'pay', shape: 'rounded', size: 'static', locale: 'en', loading: false, disabled: false });
  expect(resolveButtonOptions({ theme: 'neon' as never, label: 'x' as never, shape: 'star' as never, size: 'huge' as never })).toMatchObject({ theme: 'brand', label: 'pay', shape: 'rounded', size: 'static' });
});

it('picks the locale from the option, then the navigator, then English', () => {
  expect(resolveButtonOptions({ locale: 'vi' }).locale).toBe('vi');
  expect(resolveButtonOptions({}, 'vi-VN').locale).toBe('vi');
  expect(resolveButtonOptions({ locale: 'fr' }, 'de-DE').locale).toBe('en');
});

it.each([
  ['pay', 'en', 'Pay with', 'Pay with fianto'],
  ['subscribe', 'vi', 'Đăng ký với', 'Đăng ký với fianto'],
  ['plain', 'en', '', 'fianto'],
] as const)('labels %s in %s', (label, locale, prefix, aria) => {
  expect(buttonText(label, locale)).toEqual({ prefix, ariaLabel: aria });
});

it.each([
  ['payment_in_progress', 'payment_in_progress'],
  ['order_already_paid', 'already_paid'],
  ['rate_limited', 'busy'],
  ['checkout_unavailable', 'busy'],
  ['session_not_reissuable', 'busy'],
  ['subscription_preparing', 'busy'],
  ['order_session_mismatch', 'mismatch'],
  ['plan_limit_reached', 'unavailable'],
  ['order_id_in_use', 'unavailable'],
  ['price_ended', 'unavailable'],
  ['product_ended', 'unavailable'],
  ['subscriptions_paused', 'unavailable'],
  ['checkout_busy', 'busy'],
  ['service_busy', 'busy'],
  ['validation_failed', 'generic'],
  ['toString', 'generic'],
  [undefined, 'generic'],
] as const)('maps the error code %s to the %s status line', (code, key) => {
  expect(errorTextKey(code)).toBe(key);
  expect(STATUS_TEXT.en[key]).toBeTruthy();
  expect(STATUS_TEXT.vi[key]).toBeTruthy();
});
