import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageError } from '../config.js';
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
    expect(curlLine).toContain(`--data-binary '@${file}'`);
  });

  it('signs the exact bytes curl sends for a pretty-printed file with a trailing newline', async () => {
    const pretty = `${JSON.stringify({ id: 'evt_pretty', type: 'order.paid', timestamp: 't', data: { a: 1 } }, null, 2)}\n`;
    writeFileSync(file, pretty);
    const lines: string[] = [];
    const output = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    await sign({ payload: file, secret, timestamp: 1_790_000_000 }, output);
    const curlLine = lines.find((l) => l.startsWith('curl '))!;
    const header = (name: string) => new RegExp(`-H '${name}: ([^']+)'`).exec(curlLine)![1]!;
    const { verifyWebhook } = await import('@fianto/sdk/webhooks');
    await expect(
      verifyWebhook(pretty, { 'webhook-id': header('webhook-id'), 'webhook-timestamp': header('webhook-timestamp'), 'webhook-signature': header('webhook-signature') }, { secret, now: () => 1_790_000_000_000 }),
    ).resolves.toMatchObject({ id: 'evt_pretty' });
  });

  it("single-quotes the payload path in the curl line, escaping embedded quotes", async () => {
    const odd = join(dir, "it's a file.json");
    writeFileSync(odd, JSON.stringify({ id: 'evt_q', type: 'order.paid', timestamp: 't', data: {} }));
    const lines: string[] = [];
    const output = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    await sign({ payload: odd, secret }, output);
    const curlLine = lines.find((l) => l.startsWith('curl '))!;
    expect(curlLine).toContain(`--data-binary '@${odd.replace("'", "'\\''")}'`);
  });

  // C4: every value interpolated into the printed curl command goes through the same
  // POSIX shell-quote helper, so a hostile --id can't break out of its quoting.
  it('single-quotes a webhook-id header containing a quote, $(...), a space and a newline (C4)', async () => {
    const lines: string[] = [];
    const output = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    const dangerousId = "evt_x' $(touch /tmp/should-not-exist) has spaces\nand a newline";
    await sign({ payload: file, secret, id: dangerousId, timestamp: 1_790_000_000 }, output);
    const curlLine = lines.find((l) => l.startsWith('curl '))!;
    const expectedQuoted = `'webhook-id: ${dangerousId.replaceAll("'", "'\\''")}'`;
    expect(curlLine).toContain(`-H ${expectedQuoted}`);
  });

  it('evaluates the printed curl command in a real POSIX shell and proves a hostile --id runs nothing (C4)', async () => {
    const marker = join(dir, 'PWNED');
    const dangerousId = `evt_x' ; touch ${marker} ; echo 'y$(touch ${marker})`;
    const lines: string[] = [];
    const output = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    await sign({ payload: file, secret, id: dangerousId, timestamp: 1_790_000_000 }, output);
    const curlLine = lines.find((l) => l.startsWith('curl '))!;
    // The named risk is a copy-paste into a POSIX shell, not specifically bash — run it under
    // `sh` (dash on this box, a stricter POSIX shell than bash) with curl stubbed to a no-op
    // (no network in tests) but otherwise the exact printed line, unmodified.
    execFileSync('sh', ['-c', `curl() { :; }\n${curlLine}\n`]);
    expect(existsSync(marker)).toBe(false);
  });

  it('rejects a payload file with malformed JSON, naming the file', async () => {
    const badFile = join(dir, 'bad.json');
    writeFileSync(badFile, '{ not valid json');
    const lines: string[] = [];
    const output = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    const error: unknown = await sign({ payload: badFile, secret }, output).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toContain(badFile);
  });
});
