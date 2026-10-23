# @fianto/hono

## 0.4.0

### Minor Changes

- aa43a59: Try fianto on the devnet sandbox. Pass `network: 'devnet'` to `new Fianto()` (or set `FIANTO_NETWORK=devnet`) to use `https://devnet-api.fianto.xyz`, exported as `DEVNET_BASE_URL`, with the same application secret keys; the default stays mainnet and `baseUrl` still wins over `network` (except the other network's own host, which throws). v1 responses and webhook events now carry `network: "mainnet" | "devnet"`, and `verifyWebhook` takes an optional `{ network }` that throws `WebhookVerificationError` (`network_mismatch`) for an event from the other network, or one with no `network`. A devnet API call may answer 503 `service_busy` with `Retry-After` when the sandbox cannot reach its identity source; retry it. `createWebhookHandler` and `createCheckoutHandler` accept `network` too (the webhook handler refuses the other network's events with 400 and `onVerificationError`; the checkout handler uses it for the client it creates). If you switch exhaustively over `WebhookVerificationFailure`, add `network_mismatch`.
  
  The CLI takes `--network mainnet|devnet` (or `FIANTO_NETWORK`) on every command that calls the API, including `events tail`; a bad value exits 2. `fianto trigger` samples carry that network, and `events tail` forwards each event's own `network`, so a handler built with `network: 'devnet'` accepts both.
  
  An explicit `network` option now refuses a base URL that is the other network's own host (for example `network: 'devnet'` with `FIANTO_BASE_URL=https://api.fianto.xyz`): it throws a `FiantoError` naming both, instead of silently sending devnet calls to production. Any other `baseUrl` (self-hosted, local) still wins.

### Patch Changes

- Updated dependencies [db3fea2]
- Updated dependencies [aa43a59]
  - @fianto/sdk@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [fbc0e6a]
- Updated dependencies [a996a46]
  - @fianto/sdk@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [2443319]
  - @fianto/sdk@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [353ca8f]
  - @fianto/sdk@0.1.1
