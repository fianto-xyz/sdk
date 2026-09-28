import { PayButton } from './pay-button';

// A Server Component: it renders the client PayButton but does no fianto work itself — that
// lives in app/api/checkout/route.ts (price decided server-side) and
// app/api/webhooks/fianto/route.ts (fulfilment).
export default function Page() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '10vh auto', textAlign: 'center' }}>
      <h1>fianto Next.js example</h1>
      <p>Subscribe to the Pro plan with the Pay with fianto button.</p>
      <PayButton plan="pro" />
    </main>
  );
}
