---
'@fianto/sdk': minor
---

Products and prices a merchant stops selling are now `ENDED`, not `ARCHIVED`: `status` is
`"ACTIVE" | "ENDED"`, `archived_at` is `ended_at`, the list filter takes `status=ENDED`, and the
error codes `price_archived` / `product_archived` are `price_ended` / `product_ended`. Ending a
recurring price cancels its subscribers at the end of their current period (each one sends
`subscription.cancel_scheduled`).
