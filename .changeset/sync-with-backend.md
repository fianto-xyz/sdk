---
'@fianto/sdk': patch
---

Match the checkout route, the client and the docs to what the API does today.

- `createCheckoutHandler` relays `409 order_id_in_use` (a completed subscription checkout keeps its `order_id`, so a new subscribe needs a new one) and `422 merchant_token_account_missing`, instead of a generic 500. It also relays the API's `503 checkout_busy`, `service_busy` and `subscriptions_paused`, with `retry-after` passed through, once the client has stopped retrying them.
- `createCheckoutHandler` no longer hands out a new link to an order's open session when the requested `price_id` has since ended. It answers `422 price_ended` and passes an `OpenSessionPriceEndedError` (exported from `@fianto/sdk/handlers`) to `onError`. The open session is left as it is.
- `createCheckoutHandler` no longer lists `subscription_preparing`: neither creating a session nor reissuing its link can answer it.
- The `payment_in_progress` message now says a payment *may* already be in progress, because the API also sends that code when the last built transaction could still land.
- `429 plan_limit_reached` is no longer retried. It is a per-day cap and comes with no `Retry-After`.
- `@fianto/js` button: `order_id_in_use`, `price_ended`, `product_ended` and `subscriptions_paused` now show "Checkout isn't available right now.", and `checkout_busy` / `service_busy` show the busy line. These codes are added to `CheckoutSessionErrorCode`. `subscription_preparing` is removed from that type.
- Docs: `checkoutSessions.create` returns `url: null` for an order that already has an open session, so call `reissueLink`. The reissue refusals, the `subscriptions.cancel` outcomes, the 503 busy codes and the cap of 10,000 held webhook deliveries are now documented. The Next.js example uses a new subscription `order_id` once a subscribe completes, and it grants and revokes access on `subscription.created` / `subscription.ended`.

**Correction to the 0.2.0 note**, "Ending a recurring price cancels its subscribers … (each one sends `subscription.cancel_scheduled`)". Ending a recurring price schedules a merchant cancel at period end only for live subscribers that have no cancel yet. Each of those sends `subscription.cancel_scheduled` with `cancel_reason: MERCHANT_CANCELED`. A subscriber who already cancelled keeps their own cancel and sends no new event. Prices archived before End replaced Archive are not affected. No renewal is charged after the End, and an open subscription checkout for that price can no longer be paid (`subscription_plan_failed` on the checkout page).
