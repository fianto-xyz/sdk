# @fianto/sdk

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
