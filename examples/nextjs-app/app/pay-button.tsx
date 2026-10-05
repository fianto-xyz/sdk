'use client';

import { FiantoButton, FiantoCheckoutError, fetchCheckoutSession } from '@fianto/react';
import { useState } from 'react';

// Money safety — see @fianto/js's README ("The four statuses") and @fianto/sdk's README
// ("Money safety") before changing this copy:
//   - `succeeded` means the payer's browser saw checkout finish ON THE CHECKOUT PAGE. It is
//     NOT proof of payment or settlement — only a verified `order.paid` /
//     `subscription.created` webhook (see app/api/webhooks/fianto/route.ts) or a server-side
//     `fianto.orders.retrieve(id)` / `fianto.subscriptions.retrieve(id)` call proves that.
//   - `canceled` does NOT mean nothing was charged either — a transaction the payer already
//     built can still land on-chain after they clicked "cancel" on the checkout page. Never
//     say "you have not been charged"; point them at their order status instead.
//   - `expired` similarly never says just "try again": a payment that landed right as the
//     session expired is still possible, so check the order first.
//   - `closed` means UNKNOWN, not "nothing was charged" — the popup closed without ever
//     posting a result back (the payer, a browser extension, anything). Never tell the payer
//     nothing was charged on this status; reconcile from the order/subscription state instead.
// Not typed against @fianto/js's CheckoutResult union directly: this example only takes
// @fianto/nextjs, @fianto/react and @fianto/sdk as dependencies (matching what it imports),
// and @fianto/js is a transitive dependency of @fianto/react — `result`'s type below is
// inferred from FiantoButtonProps['onResult'] instead.
const STATUS_COPY: Record<string, string> = {
  succeeded: 'Almost done — we are confirming your payment. Your order will update once it is complete.',
  canceled: 'Checkout canceled. If a payment went through anyway, check your order status before trying again.',
  expired: 'That checkout link expired. Check your order status before trying again.',
  closed:
    "We couldn't tell what happened. If you were charged, it will show up on your account shortly — please do not assume nothing happened.",
};

// The checkout route's error.message is written for the merchant (it can name a misconfigured
// param, an internal detail, etc.) — never render it to the payer. Show a short line keyed on
// the error's `code` instead (every error @fianto/js/@fianto/react throw is a
// FiantoCheckoutError, which always carries one), and log the real message for the merchant.
const ERROR_COPY: Record<string, string> = {
  payment_in_progress: 'A payment for this order may already be in progress. Check your account before trying again.',
  order_already_paid: 'This order has already been paid.',
  order_session_mismatch: 'This checkout is out of date. Please refresh and try again.',
  rate_limited: 'Checkout is busy right now. Please try again shortly.',
  checkout_unavailable: 'Checkout is busy right now. Please try again shortly.',
  session_not_reissuable: 'Checkout is busy right now. Please try again shortly.',
  checkout_busy: 'Checkout is busy right now. Please try again shortly.',
  service_busy: 'Checkout is busy right now. Please try again shortly.',
  // Retrying the same request cannot fix these: never say "try again".
  order_id_in_use: 'This subscription has already been started. Check your account.',
  price_ended: 'This plan is no longer available.',
  product_ended: 'This plan is no longer available.',
  plan_limit_reached: "Subscriptions can't be started right now.",
  subscriptions_paused: "Subscriptions can't be started right now.",
};
const GENERIC_ERROR_COPY = 'Checkout could not be started. Please try again.';

export function PayButton({ plan }: { plan: string }) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <FiantoButton
        session={() => fetchCheckoutSession('/api/checkout', { body: { plan } })}
        label="subscribe"
        onResult={(result) => setMessage(STATUS_COPY[result.status] ?? `Unexpected status: ${result.status}`)}
        onError={(error) => {
          console.error(error); // the merchant-facing message and code — never shown to the payer
          const code = error instanceof FiantoCheckoutError ? error.code : undefined;
          setMessage((code && ERROR_COPY[code]) ?? GENERIC_ERROR_COPY);
        }}
      />
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
