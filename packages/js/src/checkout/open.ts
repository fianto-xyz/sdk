import { PopupBlockedError } from './errors.js';
import { checkoutStatusFrom } from './message.js';
import { POPUP_NAME, popupFeatures, showLoading } from './popup.js';
import { resolveSession, type CheckoutSessionSource } from './session.js';

export type CheckoutStatus = 'succeeded' | 'canceled' | 'expired' | 'closed';
export interface CheckoutResult { status: CheckoutStatus; session_id: string }
export interface OpenCheckoutOptions {
  session: CheckoutSessionSource;
  fallback?: 'redirect' | 'none';
  popup?: { width?: number; height?: number };
}

const POLL_MS = 500;
let supersede: (() => void) | null = null;

/**
 * Opens hosted checkout in a popup. Call it synchronously inside a click handler.
 * `succeeded` means the payer's transaction was confirmed on the page — NOT that the order is
 * settled: fulfil only from the `order.paid` webhook or a server-side retrieve. `closed` means
 * UNKNOWN (the payer closed the window) — never tell them nothing was charged.
 */
export function openCheckout(options: OpenCheckoutOptions): Promise<CheckoutResult> {
  supersede?.();
  const popup = window.open('', POPUP_NAME, popupFeatures(options.popup?.width, options.popup?.height));
  if (!popup) {
    if ((options.fallback ?? 'redirect') === 'none') return Promise.reject(new PopupBlockedError());
    return resolveSession(options.session).then((session) => {
      window.location.assign(session.url);
      return new Promise<never>(() => {});
    });
  }
  showLoading(popup);

  return resolveSession(options.session).then(
    (session) => new Promise<CheckoutResult>((resolve) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      const finish = (status: CheckoutStatus) => {
        window.removeEventListener('message', onMessage);
        if (timer !== undefined) clearInterval(timer);
        if (supersede === cancel) supersede = null;
        resolve({ status, session_id: session.id });
      };
      const cancel = () => finish('closed');
      const onMessage = (event: MessageEvent) => {
        const status = checkoutStatusFrom(event, popup, session.origin, session.id);
        if (status) finish(status);
      };
      supersede = cancel;
      window.addEventListener('message', onMessage);
      timer = setInterval(() => { if (popup.closed) finish('closed'); }, POLL_MS);
      popup.location.replace(session.url);
    }),
    (error: unknown) => {
      popup.close();
      throw error;
    },
  );
}
