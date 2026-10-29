---
"@fianto/sdk": minor
---

Orders carry the payer's network fee: since 29 October 2026 every one-time payment carries the same flat USDC network fee as a subscription charge (a Fianto setting, currently 0.01 USDC), paid by the payer on top of the price and Fianto's fee.

- `Order` gains `network_fee_amount` (always present on v1 reads; `'0'` on an order whose checkout was opened before the fee). The `order.paid`, `order.expired` and `order.duplicate_payment` webhook payloads gain an optional `network_fee_amount`, absent on events created before one-time payments carried the network fee (October 2026).
- An order's `total_amount` is now `amount + fee_amount + network_fee_amount`, as it already was on checkout sessions, payments and subscriptions. A `mode: 'payment'` session's and a one-off payment's `network_fee_amount` is now the real fee, no longer `'0'`.
- `sampleEvent` now includes the network fee (`'10000'`, inside `total_amount`) on `checkout.session.*` and `order.*` events.

Why minor: a new field on a public type (nothing removed or narrowed), and an order's `total_amount` now counts a fee it did not count before, which code that adds up `amount + fee_amount` itself must take into account.
