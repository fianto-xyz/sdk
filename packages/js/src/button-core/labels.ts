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

/** Payer-facing status lines. Never a route's own message: that is written for the merchant. */
export type StatusTextKey = 'payment_in_progress' | 'already_paid' | 'busy' | 'lost' | 'mismatch' | 'unavailable' | 'generic';

export const STATUS_TEXT: Record<ButtonLocale, Record<StatusTextKey, string>> = {
  en: {
    payment_in_progress: 'A payment for this order is already in progress.',
    already_paid: 'This order has already been paid.',
    busy: 'Checkout is busy right now. Please try again shortly.',
    // `closed` is unknown: never say whether anything was charged.
    lost: 'Lost track of the checkout window. Check your order status before trying again.',
    // Retrying with the same terms cannot succeed here (order_session_mismatch): the page
    // itself needs to rebuild the checkout terms, so "try again" alone would be false comfort.
    mismatch: 'This checkout changed — reload the page and try again.',
    // plan_limit_reached: a shop-side condition the payer cannot fix by retrying — stay neutral,
    // never promise a retry will work.
    unavailable: "Checkout isn't available right now.",
    generic: 'Checkout could not be started. Please try again.',
  },
  vi: {
    payment_in_progress: 'Đơn hàng này đang được thanh toán.',
    already_paid: 'Đơn hàng này đã được thanh toán.',
    busy: 'Hệ thống thanh toán đang bận. Vui lòng thử lại sau ít phút.',
    lost: 'Mất kết nối với cửa sổ thanh toán. Vui lòng kiểm tra trạng thái đơn hàng trước khi thử lại.',
    mismatch: 'Đơn thanh toán đã thay đổi — vui lòng tải lại trang và thử lại.',
    unavailable: 'Thanh toán hiện không khả dụng.',
    generic: 'Không thể bắt đầu thanh toán. Vui lòng thử lại.',
  },
};

const ERROR_KEYS: Readonly<Record<string, StatusTextKey>> = {
  payment_in_progress: 'payment_in_progress',
  order_already_paid: 'already_paid',
  checkout_unavailable: 'busy',
  rate_limited: 'busy',
  session_not_reissuable: 'busy',
  subscription_preparing: 'busy',
  order_session_mismatch: 'mismatch',
  plan_limit_reached: 'unavailable',
};

/** The status line for a failed checkout start, from the error's `code` (anything else: generic). */
export function errorTextKey(code: string | undefined): StatusTextKey {
  return (code !== undefined && Object.prototype.hasOwnProperty.call(ERROR_KEYS, code) && ERROR_KEYS[code]) || 'generic';
}
