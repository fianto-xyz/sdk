import type { ButtonLabel, ButtonLocale } from './options.js';

type Prefixed = Exclude<ButtonLabel, 'plain'>;

const PREFIXES: Record<ButtonLocale, Record<Prefixed, string>> = {
  en: {
    pay: 'Pay with',
    buy: 'Buy with',
    checkout: 'Check out with',
    subscribe: 'Subscribe with',
    donate: 'Donate with',
  },
  vi: {
    pay: 'Thanh toán với',
    buy: 'Mua với',
    checkout: 'Thanh toán qua',
    subscribe: 'Đăng ký với',
    donate: 'Quyên góp qua',
  },
};

/** Spec §10.2: `label 'plain'` is logo-only, so it carries neither a prefix nor a "with fianto" tail. */
export function buttonText(label: ButtonLabel, locale: ButtonLocale): { prefix: string; ariaLabel: string } {
  if (label === 'plain') return { prefix: '', ariaLabel: 'fianto' };
  const prefix = PREFIXES[locale][label];
  return { prefix, ariaLabel: `${prefix} fianto` };
}

export const ERROR_TEXT: Record<ButtonLocale, Record<'payment_in_progress' | 'generic', string>> = {
  en: {
    payment_in_progress: 'A payment for this order is already in progress.',
    generic: 'Checkout could not be started. Please try again.',
  },
  vi: {
    payment_in_progress: 'Đơn hàng này đang được thanh toán.',
    generic: 'Không thể bắt đầu thanh toán. Vui lòng thử lại.',
  },
};
