# @fianto/sdk

## 0.7.0

### Minor Changes

- ffc6bfa: Card payments: a payer can pay by card, through the merchant's own Stripe account, as well as in crypto. The SDK types both rails, the new refund, dispute and invoice events, and card test samples.
  
  - **Responses are typed by rail.** `Payment` is `CryptoPayment | CardPayment`, `Subscription` is `CryptoSubscription | CardSubscription`, and `Order['payment']` and `CheckoutSession['payment']` carry `gateway` (`'solana' | 'stripe'`) and `method` (`'crypto' | 'card'`). Narrow on `method`: a card payment has `signature`, `slot` and `block_time` null, `card: { brand, last4 } | null`, `customer.wallet` null, `currency: 'USD'` and fees `'0'`. A crypto payment's `signature` is a `string` after the check. Payments and orders gain `refund_status` (`none | partial | full`) and `refunded_amount`. `CheckoutSession['payment']` is `PaidSessionPayment | null`: v1 never sends the all-null object.
  - **`checkoutSessions.create` takes `payment_methods`** (`('crypto' | 'card')[]`; absent = every method the merchant has enabled). `['card']` that no card can serve throws `422 payment_method_unavailable`, with the new `APIError.method` (`'card'`). The checkout handlers relay it to the browser as "Card payment is not available for this checkout.", and `<fianto-button>` / `<FiantoButton>` show "Checkout isn't available right now." for it.
  - **New amount helpers.** `usd.toBaseUnits` (at most 2 decimals), `usd.fromBaseUnits` and `usd.format` (`'$25.00'`), beside `usdc`. `money.format(base, currency, { symbol? })` formats either currency; it takes a `Currency` (`'USDC' | 'USD'`, or any string). A new `AmountError` (`invalid_amount`) is thrown by `usd`/`money`, and `UsdcError` is now its subclass (its code stays `invalid_usdc_amount`).
  - **New webhook events:** `payment.refunded`, `payment.disputed`, `invoice.issued`, `invoice.paid`, `invoice.voided`, `invoice.payment_recorded` and `credit_note.issued`, each with a typed callback (`onPaymentRefunded`, `onPaymentDisputed`, `onInvoiceIssued`, `onInvoicePaid`, `onInvoiceVoided`, `onInvoicePaymentRecorded`, `onCreditNoteIssued`). Session, order and subscription payloads are unions on `method`; an event stored before card payments has no `gateway`/`method` and is crypto, so branch as `method === 'card'`, then `else`. New types `PaymentRefundedEvent` and `PaymentDisputedEvent`.
  - **`refundDelta(event.data)`** (`@fianto/sdk/webhooks`) is how much one `payment.refunded` event moved the payment's `refunded_amount`: `+applied_amount` for `succeeded` and `dispute_lost`, `−applied_amount` for `failed` and `reversed`. Add it once per event id onto a total seeded from `GET /v1/payments/{id}`. It throws `AmountError` for a bad `applied_amount`, and the new `RefundStatusError` (code `unknown_refund_status`, narrowed by `isFiantoError`) for a status this SDK version does not know.
  - **Card samples.** `sampleEvent(type, { method: 'card' })` builds the card form of a session, order, payment or subscription event; `payment.disputed` is card by default. Every sample now carries every field today's backend sends. The CLI gains `fianto trigger <type> --forward-to <url> --method crypto|card`, and a card sample's status line reads `(local card sample)`.
  - New error codes in `ErrorCode`: `payment_method_unavailable`, `gateway_not_offered`, `cursor_invalid`, `discount_not_allowed_for_document`, `invoice_not_found`, and two the devnet sandbox answers to a test key of a merchant still onboarding: `merchant_not_approved` (403, on a route that waits for approval) and `checkout_wallet_required` (409, a checkout session before the merchant has set a test wallet).
  
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
  - The errors `new Fianto()` throws for a key on the other network now say how to fix it: the network a key works on, the other key's prefix, and `network` (or `FIANTO_NETWORK`) or `baseUrl` (or `FIANTO_BASE_URL`) to change. Their opening words are unchanged.
  - `sampleEvent` results gain the new fields (`gateway`/`method`, `refund_status`/`refunded_amount`, `list_amount`/`discount_amount`/`discount`, and the subscription `gateway`/`method`/`card`): a test that compares a whole sample with a hand-written object must add them.

## 0.6.0

### Minor Changes

- a5e0638: Each application now has a live secret key (`fian_sk_live_…`, mainnet only) and a test secret key (`fian_sk_test_…`, devnet only). The SDK and CLI read the network from the key:
  
  - With no `network` option and no `FIANTO_NETWORK` (CLI: no `--network`), a `fian_sk_test_` key selects `devnet` and its API (`https://devnet-api.fianto.xyz`); any other key keeps the old default, `mainnet`.
  - An explicit network that contradicts the key's prefix — a live key with `devnet`, or a test key with `mainnet`, from the option or `FIANTO_NETWORK` — throws a `FiantoError` at construction, before any request (the CLI exits `1`). Before, the API refused these calls with 401.
  - A key whose `baseUrl` / `FIANTO_BASE_URL` is the other network's API throws too, however the network was set: a test key with `https://api.fianto.xyz`, a live key with `https://devnet-api.fianto.xyz`. A custom or local base URL still wins silently. A key with neither prefix is not checked.
  - New typed API error code `api_key_wrong_network` (401): a real key sent to the other network's API.
  
  Placeholder wording, for owner approval: the two new `FiantoError` messages, `appSecret is a <live|test> key (fian_sk_<live|test>_) but network is "<network>". Use a <test|live> key, or change network.` and `appSecret is a <live|test> key (fian_sk_<live|test>_), for <mainnet|devnet>, but the base URL is <url>, the <devnet|mainnet> API. Remove FIANTO_BASE_URL / baseUrl, or use a <test|live> key.`
  
  Why minor: code that set no network and used a test key now reaches devnet instead of mainnet, and a key/network mismatch now throws at construction instead of failing per request.

## 0.5.0

### Minor Changes

- 999b0bf: Orders carry the payer's network fee: since 29 October 2026 every one-time payment carries the same flat USDC network fee as a subscription charge (a Fianto setting, currently 0.01 USDC), paid by the payer on top of the price and Fianto's fee.
  
  - `Order` gains `network_fee_amount` (always present on v1 reads; `'0'` on an order whose checkout was opened before the fee). The `order.paid`, `order.expired` and `order.duplicate_payment` webhook payloads gain an optional `network_fee_amount`, absent on events created before one-time payments carried the network fee (October 2026).
  - An order's `total_amount` is now `amount + fee_amount + network_fee_amount`, as it already was on checkout sessions, payments and subscriptions. A `mode: 'payment'` session's and a one-off payment's `network_fee_amount` is now the real fee, no longer `'0'`.
  - `sampleEvent` now includes the network fee (`'10000'`, inside `total_amount`) on `checkout.session.*` and `order.*` events.
  
  Why minor: a new field on a public type (nothing removed or narrowed), and an order's `total_amount` now counts a fee it did not count before, which code that adds up `amount + fee_amount` itself must take into account.

## 0.4.1

### Patch Changes

- c2e0d4d: Add four codes from the backend spec to the typed API error codes:
  
  - `transaction_would_fail` (422): the payer-signed transaction would fail on Solana right now, so nothing was sent;
  - `transaction_expired` (422): the payer approved the transaction after its blockhash expired, so nothing was sent;
  - `payer_is_merchant` (422): the paying wallet is the one that receives the payment;
  - `client_ip_invalid` (400): the request's client IP could not be read.
  
  The first three are answered to the hosted checkout page while a payer pays (build and submit), not by the v1 routes your server calls; they are typed here because they share the API's error-code list.

## 0.4.0

### Minor Changes

- aa43a59: Try fianto on the devnet sandbox. Pass `network: 'devnet'` to `new Fianto()` (or set `FIANTO_NETWORK=devnet`) to use `https://devnet-api.fianto.xyz`, exported as `DEVNET_BASE_URL`, with the same application secret keys; the default stays mainnet and `baseUrl` still wins over `network` (except the other network's own host, which throws). v1 responses and webhook events now carry `network: "mainnet" | "devnet"`, and `verifyWebhook` takes an optional `{ network }` that throws `WebhookVerificationError` (`network_mismatch`) for an event from the other network, or one with no `network`. A devnet API call may answer 503 `service_busy` with `Retry-After` when the sandbox cannot reach its identity source; retry it. `createWebhookHandler` and `createCheckoutHandler` accept `network` too (the webhook handler refuses the other network's events with 400 and `onVerificationError`; the checkout handler uses it for the client it creates). If you switch exhaustively over `WebhookVerificationFailure`, add `network_mismatch`.
  
  The CLI takes `--network mainnet|devnet` (or `FIANTO_NETWORK`) on every command that calls the API, including `events tail`; a bad value exits 2. `fianto trigger` samples carry that network, and `events tail` forwards each event's own `network`, so a handler built with `network: 'devnet'` accepts both.
  
  An explicit `network` option now refuses a base URL that is the other network's own host (for example `network: 'devnet'` with `FIANTO_BASE_URL=https://api.fianto.xyz`): it throws a `FiantoError` naming both, instead of silently sending devnet calls to production. Any other `baseUrl` (self-hosted, local) still wins.

### Patch Changes

- db3fea2: Mark `ErrorCode.InsufficientSol` (`insufficient_sol`) as deprecated. fianto now pays every buyer's Solana network fee and account deposit, so the API never returns it; the code stays in the enum so existing handlers still compile. The generated types also pick up the OpenAPI spec's current coupon fields (`discount`, `discount_amount` and `list_amount` on orders, checkout sessions, subscriptions and their webhook payloads) and three error codes: `ErrorCode.BodyTooDeep` (`body_too_deep`), `ErrorCode.CheckoutAmountChanged` (`checkout_amount_changed`) and `ErrorCode.DiscountUnavailable` (`discount_unavailable`).

## 0.3.0

### Minor Changes

- fbc0e6a: Add the renewal network fee to the types, and use the API's own busy wording.
  
  - `CheckoutSession`, `Payment` and `Subscription` gain `network_fee_amount` (always present; `'0'` for a one-off payment, a `mode: 'payment'` session, or a subscription whose plan was created before the fee). Webhook payloads gain an optional `network_fee_amount` on `checkout.session.*` and `subscription.*` events, and an optional `period.network_fee_due`; both are absent on events created before the fee (October 2026).
  - `total_amount` on sessions, payments, subscriptions and those webhook payloads is `amount + fee_amount + network_fee_amount`. The network fee is a flat fee the payer pays on every subscription charge, the first one included, fixed per plan when the plan is created (0.01 USDC by default). Orders are unchanged.
  - `sampleEvent` now includes the network fee on `subscription.*` events (`'10000'`, inside `total_amount`), a `period` on `subscription.created` and `subscription.renewed`, and `network_fee_amount: '0'` on `checkout.session.*` events.
  - `createCheckoutHandler` relays `503 checkout_busy` as "Payments are very busy right now. Nothing was charged. Try again in a few seconds." and `503 service_busy` as "Fianto is very busy right now. Try again in a few seconds.", the API's own messages.
  
  Why minor: the release adds new fields to public types (no field is removed or narrowed), and `total_amount` now counts a fee it did not count before, which code that adds up `amount + fee_amount` itself must take into account.

### Patch Changes

- a996a46: Match the checkout route, the client and the docs to what the API does today.
  
  - `createCheckoutHandler` relays `409 order_id_in_use` (a completed subscription checkout keeps its `order_id`, so a new subscribe needs a new one) and `422 merchant_token_account_missing`, instead of a generic 500. It also relays the API's `503 checkout_busy`, `service_busy` and `subscriptions_paused`, with `retry-after` passed through, once the client has stopped retrying them.
  - `createCheckoutHandler` no longer hands out a new link to an order's open session when the requested `price_id` has since ended. It answers `422 price_ended` and passes an `OpenSessionPriceEndedError` (code `open_session_price_ended`, exported from `@fianto/sdk/handlers`) to `onError`. The open session is left as it is.
  - `createCheckoutHandler` no longer lists `subscription_preparing`: neither creating a session nor reissuing its link can answer it.
  - The `payment_in_progress` message now says a payment *may* already be in progress, because the API also sends that code when the last built transaction could still land.
  - `429 plan_limit_reached` (a per-day cap with no `Retry-After`) and `503 subscriptions_paused` (a switch that only changes when fianto restarts) are no longer retried.
  - `@fianto/js` button: `order_id_in_use`, `price_ended`, `product_ended` and `subscriptions_paused` now show "Checkout isn't available right now.", and `checkout_busy` / `service_busy` show the busy line. These codes are added to `CheckoutSessionErrorCode`. `subscription_preparing` is removed from that type.
  - Docs: `checkoutSessions.create` returns `url: null` for an order that already has an open session, so call `reissueLink`. The reissue refusals, the `subscriptions.cancel` outcomes, the 503 busy codes and the cap of 10,000 held webhook deliveries are now documented. The Next.js example keeps one subscription `order_id` per subscription and moves to a new one once it has ended, and it grants and revokes access on `subscription.created` / `subscription.ended`.
  
  **Correction to the 0.2.0 note**, "Ending a recurring price cancels its subscribers … (each one sends `subscription.cancel_scheduled`)". Ending a recurring price schedules a merchant cancel at period end only for live subscribers that have no cancel yet. Each of those sends `subscription.cancel_scheduled` with `cancel_reason: MERCHANT_CANCELED`. A subscriber who already cancelled keeps their own cancel and sends no new event. The merchant cancel is still recorded, so if that payer resumes, it takes over and a second `subscription.cancel_scheduled` (`MERCHANT_CANCELED`) is sent. Prices archived before End replaced Archive are not affected. No new renewal charge is started after the End (one already sent can still land), and an open subscription checkout for that price can no longer be paid (`subscription_plan_failed` on the checkout page).

## 0.2.0

### Minor Changes

- 2443319: Products and prices a merchant stops selling are now `ENDED`, not `ARCHIVED`: `status` is
  `"ACTIVE" | "ENDED"`, `archived_at` is `ended_at`, the list filter takes `status=ENDED`, and the
  error codes `price_archived` / `product_archived` are `price_ended` / `product_ended`. Ending a
  recurring price cancels its subscribers at the end of their current period (each one sends
  `subscription.cancel_scheduled`).

## 0.1.1

### Patch Changes

- 353ca8f: Add `order_id_in_use` to the typed API error codes: the API now answers 409 `order_id_in_use` when a checkout session is created with an `order_id` that already belongs to a completed subscription checkout.
