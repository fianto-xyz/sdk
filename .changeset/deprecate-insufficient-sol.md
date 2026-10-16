---
'@fianto/sdk': patch
---

Mark `ErrorCode.InsufficientSol` (`insufficient_sol`) as deprecated. fianto now pays every buyer's Solana network fee and account deposit, so the API never returns it; the code stays in the enum so existing handlers still compile. The generated types also pick up the OpenAPI spec's current `discount`, `discount_amount` and `list_amount` fields.
