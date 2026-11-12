---
"@fianto/sdk": minor
---

Card payments: a payer can pay by card, through the merchant's own Stripe account, as well as in crypto. The SDK types both rails, the new refund, dispute and invoice events, and card test samples.

- **Responses are typed by rail.** `Payment` is `CryptoPayment | CardPayment`, `Subscription` is `CryptoSubscription | CardSubscription`, and `Order['payment']` and `CheckoutSession['payment']` carry `gateway` (`'solana' | 'stripe'`) and `method` (`'crypto' | 'card'`). Narrow on `method`: a card payment has `signature`, `slot` and `block_time` null, `card: { brand, last4 } | null`, `customer.wallet` null, `currency: 'USD'` and fees `'0'`. A crypto payment's `signature` is a `string` after the check. Payments and orders gain `refund_status` (`none | partial | full`) and `refunded_amount`. `CheckoutSession['payment']` is `PaidSessionPayment | null`: v1 never sends the all-null object.
- **`checkoutSessions.create` takes `payment_methods`** (`('crypto' | 'card')[]`; absent = every method the merchant has enabled). `['card']` that no card can serve throws `422 payment_method_unavailable`, with the new `APIError.method` (`'card'`). The checkout handlers relay it to the browser as "Card payment is not available for this checkout.", and `<fianto-button>` / `<FiantoButton>` show "Checkout isn't available right now." for it.
- **New amount helpers.** `usd.toBaseUnits` (at most 2 decimals), `usd.fromBaseUnits` and `usd.format` (`'$25.00'`), beside `usdc`. `money.format(base, currency, { symbol? })` formats either currency; it takes a `Currency` (`'USDC' | 'USD'`, or any string). A new `AmountError` (`invalid_amount`) is thrown by `usd`/`money`, and `UsdcError` is now its subclass (its code stays `invalid_usdc_amount`).
- **New webhook events:** `payment.refunded`, `payment.disputed`, `invoice.issued`, `invoice.paid`, `invoice.voided`, `invoice.payment_recorded` and `credit_note.issued`, each with a typed callback (`onPaymentRefunded`, `onPaymentDisputed`, `onInvoiceIssued`, `onInvoicePaid`, `onInvoiceVoided`, `onInvoicePaymentRecorded`, `onCreditNoteIssued`). Session, order and subscription payloads are unions on `method`; an event stored before card payments has no `gateway`/`method` and is crypto, so branch as `method === 'card'`, then `else`. New types `PaymentRefundedEvent` and `PaymentDisputedEvent`.
- **`refundDelta(event.data)`** (`@fianto/sdk/webhooks`) is how much one `payment.refunded` event moved the payment's `refunded_amount`: `+applied_amount` for `succeeded` and `dispute_lost`, `−applied_amount` for `failed` and `reversed`. Add it once per event id onto a total seeded from `GET /v1/payments/{id}`. It throws `AmountError` for a bad `applied_amount`, and the new `RefundStatusError` (code `unknown_refund_status`, narrowed by `isFiantoError`) for a status this SDK version does not know.
- **Card samples.** `sampleEvent(type, { method: 'card' })` builds the card form of a session, order, payment or subscription event; `payment.disputed` is card by default. Every sample now carries every field today's backend sends. The CLI gains `fianto trigger <type> --forward-to <url> --method crypto|card`, and a card sample's status line reads `(local card sample)`.
- New error codes in `ErrorCode`: `payment_method_unavailable`, `gateway_not_offered`, `cursor_invalid`, `discount_not_allowed_for_document`, `invoice_not_found`.

Breaking at the type level (why minor):

- `currency` widens from `'USDC'` to `'USDC' | 'USD'` on sessions, orders, payments, subscriptions and prices, and their webhook payloads (a subscription's is narrowed per branch: `'USDC'` on crypto, `'USD'` on card). Prices are never USD: `Price.currency` follows the spec, and only a card payment, an order or session charged by card, and a card subscription read `'USD'`.
- `Payment` and `Subscription` are unions: `interface X extends Payment` no longer compiles; use `type X = Payment & { … }`.
- `Subscription['customer']['wallet']` (and a subscription event's) was `string`; it is `null` for a card subscription.
- Object literals typed as v1 `Order['payment']` or `CheckoutSession['payment']` now need `gateway` and `method`. An event's `payment` needs them only on the card branch (`gateway: 'stripe', method: 'card', signature: null`): on the crypto and all-null branches they stay optional, because events stored before card payments lack them. A paid crypto payment, v1 or event, keeps a string `signature`.
- `order.duplicate_payment`'s `duplicate.signature` is `string | null`, narrowed by `duplicate.gateway`.
- The exported `MismatchedField` union gains `'payment_methods'`.
- `FiantoWebhookEvent`, `WebhookEvent`, `FiantoEvent` and `WEBHOOK_EVENT_TYPES` gain the 7 new events, so an exhaustive `switch (event.type)` needs their cases (or a `default:` branch).

Runtime changes:

- On a retry of an order with an open session, the checkout handler now compares `payment_methods`: a switch to or from `['card']` answers `409 order_session_mismatch` with `fields: ['payment_methods']`, and a card-only retry of a card-only session reissues its link (on the `price_id` path too, where its `USD` currency used to be compared strictly with the price's `USDC`).
- The webhook handler now routes the 7 new event types to their callbacks; they still reach `onEvent` as before.
- `sampleEvent` results gain the new fields (`gateway`/`method`, `refund_status`/`refunded_amount`, `list_amount`/`discount_amount`/`discount`, and the subscription `gateway`/`method`/`card`): a test that compares a whole sample with a hand-written object must add them.

Placeholder wording, for owner approval: the relay sentence "Card payment is not available for this checkout.", and the `RefundStatusError` message `Unknown payment.refunded refund status "<status>": upgrade @fianto/sdk to a version that knows it.`
