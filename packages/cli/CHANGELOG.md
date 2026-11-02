# @fianto/cli

## 0.6.0

### Minor Changes

- a5e0638: Each application now has a live secret key (`fian_sk_live_…`, mainnet only) and a test secret key (`fian_sk_test_…`, devnet only). The SDK and CLI read the network from the key:
  
  - With no `network` option and no `FIANTO_NETWORK` (CLI: no `--network`), a `fian_sk_test_` key selects `devnet` and its API (`https://devnet-api.fianto.xyz`); any other key keeps the old default, `mainnet`.
  - An explicit network that contradicts the key's prefix — a live key with `devnet`, or a test key with `mainnet`, from the option or `FIANTO_NETWORK` — throws a `FiantoError` at construction, before any request (the CLI exits `1`). Before, the API refused these calls with 401.
  - A key whose `baseUrl` / `FIANTO_BASE_URL` is the other network's API throws too, however the network was set: a test key with `https://api.fianto.xyz`, a live key with `https://devnet-api.fianto.xyz`. A custom or local base URL still wins silently. A key with neither prefix is not checked.
  - New typed API error code `api_key_wrong_network` (401): a real key sent to the other network's API.
  
  Placeholder wording, for owner approval: the two new `FiantoError` messages, `appSecret is a <live|test> key (fian_sk_<live|test>_) but network is "<network>". Use a <test|live> key, or change network.` and `appSecret is a <live|test> key (fian_sk_<live|test>_), for <mainnet|devnet>, but the base URL is <url>, the <devnet|mainnet> API. Remove FIANTO_BASE_URL / baseUrl, or use a <test|live> key.`
  
  Why minor: code that set no network and used a test key now reaches devnet instead of mainnet, and a key/network mismatch now throws at construction instead of failing per request.

### Patch Changes

- Updated dependencies [a5e0638]
  - @fianto/sdk@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [999b0bf]
  - @fianto/sdk@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [c2e0d4d]
  - @fianto/sdk@0.4.1

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
