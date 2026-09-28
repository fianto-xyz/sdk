import type { CheckoutResult } from './result.js';
import { resolveSession, type CheckoutSession, type CheckoutSessionSource } from './session.js';

/**
 * Sends the whole page to `session.url`. Normally the page unloads and this never settles; if the
 * payer comes back through the back/forward cache, the page resumes as it was, so settle `closed`
 * (UNKNOWN) and let whatever showed a spinner leave it.
 */
export function navigateToCheckout(session: CheckoutSession): Promise<CheckoutResult> {
  return new Promise((resolve) => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      window.removeEventListener('pageshow', onPageShow);
      resolve({ status: 'closed', reason: 'returned_from_redirect', session_id: session.id });
    };
    window.addEventListener('pageshow', onPageShow);
    window.location.assign(session.url);
  });
}

/**
 * Sends the whole page to hosted checkout. The returned promise normally never settles (the page
 * is leaving); it resolves `{ status: 'closed', reason: 'returned_from_redirect' }` if the payer
 * comes back to this page through the browser's back/forward cache.
 */
export async function redirectToCheckout(session: CheckoutSessionSource): Promise<CheckoutResult> {
  return navigateToCheckout(await resolveSession(session));
}
