# @fianto/sdk

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
