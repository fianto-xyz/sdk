---
'@fianto/sdk': minor
---

Add the renewal network fee to the types, and use the API's own busy wording.

- `CheckoutSession`, `Payment` and `Subscription` gain `network_fee_amount` (always present; `'0'` for a one-off payment, a `mode: 'payment'` session, or a subscription whose plan was created before the fee). Webhook payloads gain an optional `network_fee_amount` on `checkout.session.*` and `subscription.*` events, and an optional `period.network_fee_due`; both are absent on events created before the fee (October 2026).
- `total_amount` on sessions, payments, subscriptions and those webhook payloads is `amount + fee_amount + network_fee_amount`. The network fee is a flat fee the payer pays on every subscription charge, the first one included, fixed per plan when the plan is created (0.01 USDC by default). Orders are unchanged.
- `sampleEvent` now includes the network fee on `subscription.*` events (`'10000'`, inside `total_amount`), a `period` on `subscription.created` and `subscription.renewed`, and `network_fee_amount: '0'` on `checkout.session.*` events.
- `createCheckoutHandler` relays `503 checkout_busy` as "Payments are very busy right now. Nothing was charged. Try again in a few seconds." and `503 service_busy` as "Fianto is very busy right now. Nothing was changed. Try again in a few seconds.", the API's own messages.

Why minor: the release adds new fields to public types (no field is removed or narrowed), and `total_amount` now counts a fee it did not count before, which code that adds up `amount + fee_amount` itself must take into account.
