import { PopupBlockedError } from './errors.js';
import { checkoutStatusFrom } from './message.js';
import { POPUP_NAME, popupFeatures, showLoading } from './popup.js';
import { navigateToCheckout } from './redirect.js';
import type { CheckoutClosedReason, CheckoutResult } from './result.js';
import { resolveSession, type CheckoutSessionSource } from './session.js';

export interface OpenCheckoutOptions {
  session: CheckoutSessionSource;
  fallback?: 'redirect' | 'none';
  popup?: { width?: number; height?: number };
}

const POLL_MS = 500;
// A popup that reads as closed this soon after navigating to checkout was cut off from this page
// (COOP `same-origin`), not closed by a payer who had time to see it.
const UNREACHABLE_MS = 1500;
let generation = 0;
let cancelActive: (() => void) | null = null;
let activePopup: Window | null = null;
let warned = false;

function warnUnreachable(): void {
  if (warned) return;
  warned = true;
  console.warn(
    '[fianto] The checkout popup became unreachable right after opening, so its result cannot reach this page. ' +
      'This page most likely sends `Cross-Origin-Opener-Policy: same-origin`; send ' +
      '`Cross-Origin-Opener-Policy: same-origin-allow-popups` on pages that open checkout. ' +
      'The checkout may still be open: the result is unknown.',
  );
}

/** Brings the popup of the checkout in progress to the front. `false` when there is none to focus. */
export function focusCheckout(): boolean {
  if (!activePopup || activePopup.closed) return false;
  activePopup.focus();
  return true;
}

/**
 * Opens hosted checkout in a popup. Call it synchronously inside a click handler.
 * `succeeded` means the payer's transaction was confirmed on the page — NOT that the order is
 * settled: fulfil only from the `order.paid` webhook or a server-side retrieve. `closed` means
 * UNKNOWN (see its `reason`) — never tell the payer nothing was charged.
 *
 * The result only arrives when the page that called `openCheckout` is on the same origin as the
 * session's `success_url`: that's who the checkout page `postMessage`s. On any other origin the
 * browser delivers nothing, and the promise resolves `closed` once the payer closes the popup.
 */
export function openCheckout(options: OpenCheckoutOptions): Promise<CheckoutResult> {
  cancelActive?.();
  const popup = window.open('', POPUP_NAME, popupFeatures(options.popup?.width, options.popup?.height));
  activePopup = popup;

  // A generation token, taken synchronously before `session` (which may take a while) is
  // awaited — also on the popup-blocked path, so an older call still waiting on its session can
  // never navigate its popup once this newer call has started. A later openCheckout() call bumps
  // `generation` at its own entry, via `cancelActive` above if this call is already listening,
  // or — if this call is still waiting on its own session — via the `own !== generation` check
  // below once that session finally settles.
  const own = ++generation;
  const superseded = (session_id: string): CheckoutResult => ({ status: 'closed', reason: 'superseded', session_id });

  if (!popup) {
    if ((options.fallback ?? 'redirect') === 'none') return Promise.reject(new PopupBlockedError());
    // Superseded while the session was still in flight: a newer call already owns the
    // page/popup. Resolve closed without navigating the page away from it.
    return resolveSession(options.session).then((session) => (own === generation ? navigateToCheckout(session) : superseded(session.id)));
  }
  showLoading(popup);

  return resolveSession(options.session).then(
    (session) => {
      // Superseded while the session was still in flight: the newer call already owns the
      // popup. Resolve closed without navigating it or listening for its messages.
      if (own !== generation) return superseded(session.id);
      return new Promise<CheckoutResult>((resolve) => {
        let timer: ReturnType<typeof setInterval> | undefined;
        const finish = (result: CheckoutResult) => {
          window.removeEventListener('message', onMessage);
          if (timer !== undefined) clearInterval(timer);
          if (cancelActive === cancel) cancelActive = null;
          if (activePopup === popup) activePopup = null;
          resolve(result);
        };
        const closed = (reason: CheckoutClosedReason) => finish({ status: 'closed', reason, session_id: session.id });
        const cancel = () => closed('superseded');
        const onMessage = (event: MessageEvent) => {
          const status = checkoutStatusFrom(event, popup, session.origin, session.id);
          if (status) finish({ status, session_id: session.id });
        };
        // Closed on the loading page, before checkout ever loaded in it.
        if (popup.closed) return closed('closed_by_payer');
        cancelActive = cancel;
        window.addEventListener('message', onMessage);
        const navigatedAt = Date.now();
        timer = setInterval(() => {
          if (!popup.closed) return;
          if (Date.now() - navigatedAt > UNREACHABLE_MS) return closed('closed_by_payer');
          warnUnreachable();
          closed('unreachable');
        }, POLL_MS);
        popup.location.replace(session.url);
      });
    },
    (error: unknown) => {
      // Only close the popup if this call still owns it: a superseded call's session failing
      // must not close the popup the newer call is now using.
      if (own === generation) {
        popup.close();
        activePopup = null;
      }
      throw error;
    },
  );
}
