// Smoke-tests the BUILT @fianto/sdk artifacts on the oldest supported runtime (engines.node
// ">=20.3"). Run after `pnpm build`, on Node 20.3.0: `node scripts/smoke-runtime.mjs`.
//
// Everything else in CI runs on Node >=22 (tsdown, jsdom, size-limit and changesets all require
// it), so this is the only check that actually exercises the published dist/ output on the
// floor of engines.node. It imports the ESM build and requires the CJS build of every
// @fianto/sdk entry point, constructs a client, and signs + verifies one webhook end to end.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const sdkDist = resolve('packages/sdk/dist');

const failures = [];

function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .catch((error) => {
      failures.push({ label, error });
    });
}

const esm = {};
const cjs = {};

await check('import(.) ESM', async () => {
  esm.index = await import(`${sdkDist}/index.js`);
});
await check('import(./webhooks) ESM', async () => {
  esm.webhooks = await import(`${sdkDist}/webhooks.js`);
});
await check('import(./handlers) ESM', async () => {
  esm.handlers = await import(`${sdkDist}/handlers.js`);
});

await check('require(.) CJS', () => {
  cjs.index = require(`${sdkDist}/index.cjs`);
});
await check('require(./webhooks) CJS', () => {
  cjs.webhooks = require(`${sdkDist}/webhooks.cjs`);
});
await check('require(./handlers) CJS', () => {
  cjs.handlers = require(`${sdkDist}/handlers.cjs`);
});

await check('new Fianto() (ESM build)', () => {
  if (typeof esm.index?.Fianto !== 'function') throw new Error('ESM build does not export Fianto');
  const client = new esm.index.Fianto({ appId: 'fian_app_x', appSecret: 'fian_sk_test_x' });
  if (!client) throw new Error('new Fianto(...) returned a falsy value');
});

await check('new Fianto() (CJS build)', () => {
  if (typeof cjs.index?.Fianto !== 'function') throw new Error('CJS build does not export Fianto');
  const client = new cjs.index.Fianto({ appId: 'fian_app_x', appSecret: 'fian_sk_test_x' });
  if (!client) throw new Error('new Fianto(...) returned a falsy value');
});

await check('handlers export the expected functions (ESM + CJS)', () => {
  for (const [name, mod] of [['ESM', esm.handlers], ['CJS', cjs.handlers]]) {
    if (typeof mod?.createWebhookHandler !== 'function') throw new Error(`${name} handlers build has no createWebhookHandler`);
    if (typeof mod?.createCheckoutHandler !== 'function') throw new Error(`${name} handlers build has no createCheckoutHandler`);
  }
});

await check('signWebhook/verifyWebhook round-trip (ESM build)', async () => {
  const { signWebhook, verifyWebhook } = esm.webhooks;
  if (typeof signWebhook !== 'function' || typeof verifyWebhook !== 'function') {
    throw new Error('ESM webhooks build is missing signWebhook/verifyWebhook');
  }
  const secret = 'whsec_c21va2UtcnVudGltZS10ZXN0LXNlY3JldC0zMmJ5dGVz';
  const event = { id: 'evt_smoke00000000000000000000001', type: 'order.paid', timestamp: Math.floor(Date.now() / 1000), data: {} };
  const { body, headers } = await signWebhook({ event, secret });
  const verified = await verifyWebhook(body, headers, { secret });
  if (verified.id !== event.id) throw new Error('verifyWebhook did not return the signed event');
});

await check('signWebhook/verifyWebhook round-trip (CJS build)', async () => {
  const { signWebhook, verifyWebhook } = cjs.webhooks;
  if (typeof signWebhook !== 'function' || typeof verifyWebhook !== 'function') {
    throw new Error('CJS webhooks build is missing signWebhook/verifyWebhook');
  }
  const secret = 'whsec_c21va2UtcnVudGltZS10ZXN0LXNlY3JldC0zMmJ5dGVz';
  const event = { id: 'evt_smoke00000000000000000000002', type: 'order.paid', timestamp: Math.floor(Date.now() / 1000), data: {} };
  const { body, headers } = await signWebhook({ event, secret });
  const verified = await verifyWebhook(body, headers, { secret });
  if (verified.id !== event.id) throw new Error('verifyWebhook did not return the signed event');
});

if (failures.length > 0) {
  console.error(`smoke-runtime: ${failures.length} check(s) failed on Node ${process.version}\n`);
  for (const { label, error } of failures) {
    console.error(`✖ ${label}`);
    console.error(error?.stack ?? error);
    console.error('');
  }
  process.exit(1);
}

console.log(`smoke-runtime: all checks passed on Node ${process.version}`);
