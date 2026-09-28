import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fianto } from '@fianto/sdk';
import { sampleEvent, signWebhook } from '@fianto/sdk/webhooks';
import { createApp } from './app.js';

const secret = `whsec_${randomBytes(32).toString('base64')}`;

// The vitest config in this workspace aliases the `@fianto/js` import specifier to source for
// speed. `createApp` deliberately does NOT go through that alias for the button script: it
// resolves the real installed package with `createRequire(...).resolve` (see app.ts) so the
// example serves exactly what a consumer's `pnpm add @fianto/js` would put on disk. That means
// this test depends on `packages/js/dist/fianto-button.global.iife.js` existing — build it once
// up front so the test is independent of whether a prior `pnpm build` already ran.
beforeAll(() => {
  const require = createRequire(import.meta.url);
  const scriptPath = join(dirname(require.resolve('@fianto/js/package.json')), 'dist', 'fianto-button.global.iife.js');
  if (existsSync(scriptPath)) return;
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  execFileSync('pnpm', ['--filter', '@fianto/js', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}, 120_000);

it('serves the page, the button script, the checkout route and the webhook route', async () => {
  const fianto = new Fianto({
    appId: 'fian_app_1', appSecret: 'fian_sk_live_2', baseUrl: 'https://api.test', maxRetries: 0,
    fetch: (async () => new Response(JSON.stringify({ id: 'fian_cs_1', url: 'https://pay.test/c/x' }), { status: 201 })) as never,
  });
  const server = createApp({ fianto, webhookSecret: secret }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    expect((await fetch(`${base}/`)).status).toBe(200);
    const script = await fetch(`${base}/fianto-button.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain('fianto-button');
    const checkout = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{"plan":"pro"}' });
    expect(await checkout.json()).toEqual({ id: 'fian_cs_1', url: 'https://pay.test/c/x' });
    const { body, headers } = await signWebhook({ event: sampleEvent('order.paid'), secret });
    expect((await fetch(`${base}/webhooks/fianto`, { method: 'POST', headers, body })).status).toBe(200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
