---
"@fianto/sdk": patch
---

Add `order_id_in_use` to the typed API error codes: the API now answers 409 `order_id_in_use` when a checkout session is created with an `order_id` that already belongs to a completed subscription checkout.
