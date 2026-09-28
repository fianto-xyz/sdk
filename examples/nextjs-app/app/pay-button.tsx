'use client';

import { FiantoButton, fetchCheckoutSession } from '@fianto/react';
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
  succeeded: 'Almost done — we are confirming your payment. You will get an email once it is complete.',
  canceled: 'Checkout canceled. If a payment went through anyway, check your order status before trying again.',
  expired: 'That checkout link expired. Check your order status before trying again.',
  closed:
    "We couldn't tell what happened. If you were charged, it will show up on your account shortly — please do not assume nothing happened.",
};

export function PayButton({ plan }: { plan: string }) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <FiantoButton
        session={() => fetchCheckoutSession('/api/checkout', { body: { plan } })}
        label="subscribe"
        onResult={(result) => setMessage(STATUS_COPY[result.status] ?? `Unexpected status: ${result.status}`)}
        onError={(error) => setMessage(`Something went wrong: ${error.message}`)}
      />
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
