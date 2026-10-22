---
'@fianto/sdk': minor
'@fianto/cli': minor
'@fianto/express': minor
'@fianto/hono': minor
'@fianto/js': minor
'@fianto/nextjs': minor
'@fianto/react': minor
---

Try fianto on the devnet sandbox. Pass `network: 'devnet'` to `new Fianto()` (or set `FIANTO_NETWORK=devnet`) to use `https://devnet-api.fianto.xyz`, exported as `DEVNET_BASE_URL`, with the same application secret keys; the default stays mainnet and `baseUrl` still wins over `network`. v1 responses and webhook events now carry `network: "mainnet" | "devnet"`, and `verifyWebhook` takes an optional `{ network }` that throws `WebhookVerificationError` (`network_mismatch`) for an event from the other network, or one with no `network`. A devnet API call may answer 503 `service_busy` with `Retry-After` when the sandbox cannot reach its identity source; retry it.
