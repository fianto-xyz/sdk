import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sign } from './sign.js';

const secret = 'whsec_' + Buffer.alloc(32, 1).toString('base64');

describe('sign', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fianto-cli-sign-'));
    file = join(dir, 'payload.json');
    writeFileSync(file, JSON.stringify({ id: 'evt_fixed', type: 'order.paid', timestamp: '2026-09-28T10:00:00Z', data: {} }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('signs the payload file and prints the body plus a ready curl command, never the secret', async () => {
    const lines: string[] = [];
    const output = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    await sign({ payload: file, secret, id: 'evt_fixed', timestamp: 1_790_000_000 }, output);

    const text = lines.join('\n');
    expect(text).toContain('webhook-id: evt_fixed');
    expect(text).toContain('webhook-timestamp: 1790000000');
    expect(text).toMatch(/webhook-signature: v1,/);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(secret.replace('whsec_', ''));

    const { verifyWebhook } = await import('@fianto/sdk/webhooks');
    const body = lines[0]!;
    const signatureLine = lines.find((l) => l.includes('webhook-signature:'))!;
    const signature = /webhook-signature: '?([^'\s]+)'?/.exec(signatureLine)![1]!;
    await expect(
      verifyWebhook(body, { 'webhook-id': 'evt_fixed', 'webhook-timestamp': '1790000000', 'webhook-signature': signature }, { secret, now: () => 1_790_000_000_000 }),
    ).resolves.toMatchObject({ id: 'evt_fixed' });
  });

  it('prints a curl command referencing the payload file with a $URL placeholder', async () => {
    const lines: string[] = [];
    const output = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    await sign({ payload: file, secret, id: 'evt_fixed', timestamp: 1_790_000_000 }, output);
    const curlLine = lines.find((l) => l.startsWith('curl '))!;
    expect(curlLine).toContain('"$URL"');
    expect(curlLine).toContain(`--data-binary @${file}`);
  });
});
