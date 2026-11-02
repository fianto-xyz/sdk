---
"@fianto/sdk": minor
"@fianto/cli": minor
---

Each application now has a live secret key (`fian_sk_live_…`, mainnet only) and a test secret key (`fian_sk_test_…`, devnet only). The SDK and CLI read the network from the key:

- With no `network` option and no `FIANTO_NETWORK` (CLI: no `--network`), a `fian_sk_test_` key selects `devnet` and its API (`https://devnet-api.fianto.xyz`); any other key keeps the old default, `mainnet`.
- An explicit network that contradicts the key's prefix — a live key with `devnet`, or a test key with `mainnet`, from the option or `FIANTO_NETWORK` — throws a `FiantoError` at construction, before any request (the CLI exits `1`). Before, the API refused these calls with 401.
- A test key with no network set but `baseUrl` / `FIANTO_BASE_URL` at the production API (`https://api.fianto.xyz`) throws too. A custom or local base URL still wins silently. A key with neither prefix is not checked.
- New typed API error code `api_key_wrong_network` (401): a real key sent to the other network's API.

Placeholder wording, for owner approval: the two new `FiantoError` messages, `appSecret is a <live|test> key (fian_sk_<live|test>_) but network is "<network>". Use a <test|live> key, or change network.` and `appSecret is a test key (fian_sk_test_), so network is "devnet", but the base URL is <url>, the mainnet API. Remove FIANTO_BASE_URL / baseUrl, or use a live key.`

Why minor: code that set no network and used a test key now reaches devnet instead of mainnet, and a key/network mismatch now throws at construction instead of failing per request.
