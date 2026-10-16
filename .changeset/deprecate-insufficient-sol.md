---
'@fianto/sdk': patch
---

Mark `ErrorCode.InsufficientSol` (`insufficient_sol`) as deprecated. fianto now pays every buyer's Solana network fee and account deposit, so the API never returns it; the code stays in the enum so existing handlers still compile. The generated types also pick up the OpenAPI spec's current coupon fields (`discount`, `discount_amount` and `list_amount` on orders, checkout sessions, subscriptions and their webhook payloads) and three error codes: `ErrorCode.BodyTooDeep` (`body_too_deep`), `ErrorCode.CheckoutAmountChanged` (`checkout_amount_changed`) and `ErrorCode.DiscountUnavailable` (`discount_unavailable`).
