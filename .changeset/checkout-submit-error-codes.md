---
"@fianto/sdk": patch
---

Add four codes from the backend spec to the typed API error codes:

- `transaction_would_fail` (422): the payer-signed transaction would fail on Solana right now, so nothing was sent;
- `transaction_expired` (422): the payer approved the transaction after its blockhash expired, so nothing was sent;
- `payer_is_merchant` (422): the paying wallet is the one that receives the payment;
- `client_ip_invalid` (400): the request's client IP could not be read.

The first three are answered to the hosted checkout page while a payer pays (build and submit), not by the v1 routes your server calls; they are typed here because they share the API's error-code list.
