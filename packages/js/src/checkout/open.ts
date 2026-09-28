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
let generation = 0;
let cancelActive: (() => void) | null = null;

/**
 * Opens hosted checkout in a popup. Call it synchronously inside a click handler.
 * `succeeded` means the payer's transaction was confirmed on the page — NOT that the order is
 * settled: fulfil only from the `order.paid` webhook or a server-side retrieve. `closed` means
 * UNKNOWN (the payer closed the window) — never tell them nothing was charged.
 *
 * The result only arrives when the page that called `openCheckout` is on the same origin as the
 * session's `success_url`: that's who the checkout page `postMessage`s. On any other origin the
 * browser delivers nothing, and the promise resolves `closed` once the payer closes the popup.
 */
export function openCheckout(options: OpenCheckoutOptions): Promise<CheckoutResult> {
  cancelActive?.();
  const popup = window.open('', POPUP_NAME, popupFeatures(options.popup?.width, options.popup?.height));
  if (!popup) {
    if ((options.fallback ?? 'redirect') === 'none') return Promise.reject(new PopupBlockedError());
    return resolveSession(options.session).then((session) => {
      window.location.assign(session.url);
      return new Promise<never>(() => {});
    });
  }
  showLoading(popup);

  // A generation token, captured synchronously before `session` (which may take a while) is
  // awaited: a later openCheckout() call bumps `generation` at its own entry, via `cancelActive`
  // above if this call is already listening, or — if this call is still waiting on its own
  // session — via the `own !== generation` check below once that session finally settles.
  const own = ++generation;

  return resolveSession(options.session).then(
    (session) => {
      if (own !== generation) {
        // Superseded while the session was still in flight: the newer call already owns the
        // popup. Resolve closed without navigating it or listening for its messages.
        return { status: 'closed' as const, session_id: session.id };
      }
      return new Promise<CheckoutResult>((resolve) => {
        let timer: ReturnType<typeof setInterval> | undefined;
        const finish = (status: CheckoutStatus) => {
          window.removeEventListener('message', onMessage);
          if (timer !== undefined) clearInterval(timer);
          if (cancelActive === cancel) cancelActive = null;
          resolve({ status, session_id: session.id });
        };
        const cancel = () => finish('closed');
        const onMessage = (event: MessageEvent) => {
          const status = checkoutStatusFrom(event, popup, session.origin, session.id);
          if (status) finish(status);
        };
        cancelActive = cancel;
        window.addEventListener('message', onMessage);
        timer = setInterval(() => { if (popup.closed) finish('closed'); }, POLL_MS);
        popup.location.replace(session.url);
      });
    },
    (error: unknown) => {
      // Only close the popup if this call still owns it: a superseded call's session failing
      // must not close the popup the newer call is now using.
      if (own === generation) popup.close();
      throw error;
    },
  );
}
