import { buttonText, resolveButtonOptions } from './index.js';

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
