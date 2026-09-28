export type CheckoutStatus = 'succeeded' | 'canceled' | 'expired' | 'closed';

/**
 * Why a checkout resolved `closed`. Every reason means UNKNOWN: a payment may still be confirming.
 * - `closed_by_payer`: the popup was closed after checkout had loaded in it.
 * - `unreachable`: the popup became unreachable right after it navigated to checkout — almost
 *   always this page's `Cross-Origin-Opener-Policy: same-origin`. Checkout may still be open.
 * - `superseded`: a newer `openCheckout()` call took over the popup.
 * - `returned_from_redirect`: the page was sent to checkout (popup blocked, or
 *   `redirectToCheckout`) and the payer came back to it through the back/forward cache.
 */
export type CheckoutClosedReason = 'closed_by_payer' | 'unreachable' | 'superseded' | 'returned_from_redirect';

export type CheckoutResult =
  | { status: 'succeeded' | 'canceled' | 'expired'; session_id: string }
  | { status: 'closed'; reason: CheckoutClosedReason; session_id: string };
