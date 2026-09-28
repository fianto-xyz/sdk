import { createHmac, randomBytes } from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import { verifyWebhook } from './verify.js';
import { WebhookVerificationError } from './errors.js';

const secret = `whsec_${randomBytes(32).toString('base64')}`;
const other = `whsec_${randomBytes(32).toString('base64')}`;
// The `standardwebhooks` reference library checks its own timestamp tolerance against the
// real wall clock (hardcoded 5 minutes, no override), so NOW must track actual current time
// rather than a fixed constant, or the cross-check against it goes stale. Deviation from the
// brief's literal `1_790_000_000`; see task-5-report.md.
const NOW = Math.floor(Date.now() / 1000);
const now = () => NOW * 1000;

// Runs even when the test above it throws, so a stub/spy never leaks into later tests.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function sign(key: string, id: string, ts: number, body: string | Buffer): string {
  const k = Buffer.from(key.slice('whsec_'.length), 'base64');
  return createHmac('sha256', k).update(Buffer.concat([Buffer.from(`${id}.${ts}.`), Buffer.from(body)])).digest('base64');
}

const envelope = (id = `evt_${'1'.repeat(32)}`) => ({
  id, type: 'order.paid', timestamp: '2026-09-28T10:00:00.000Z', data: { id: 'fian_ord_1' },
});

function signed(options: { body?: string; id?: string; ts?: number; keys?: string[]; extra?: string } = {}) {
  const id = options.id ?? `evt_${'1'.repeat(32)}`;
  const ts = options.ts ?? NOW;
  const body = options.body ?? JSON.stringify(envelope(id));
  const sigs = (options.keys ?? [secret]).map((k) => `v1,${sign(k, id, ts, body)}`);
  if (options.extra) sigs.unshift(options.extra);
  return { body, headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': sigs.join(' ') } };
}

async function reason(promise: Promise<unknown>) {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(WebhookVerificationError);
  return (error as WebhookVerificationError).reason;
}

it('verifies a body the reference library also accepts', async () => {
  const { body, headers } = signed();
  expect(() => new Webhook(secret).verify(body, headers)).not.toThrow();
  const event = await verifyWebhook(body, headers, { secret, now });
  expect(event).toMatchObject({ type: 'order.paid', id: `evt_${'1'.repeat(32)}` });
});

it('accepts Headers, a Uint8Array and an ArrayBuffer', async () => {
  const { body, headers } = signed();
  const bytes = new TextEncoder().encode(body);
  await expect(verifyWebhook(bytes, new Headers(headers), { secret, now })).resolves.toBeDefined();
  await expect(verifyWebhook(bytes.buffer, headers, { secret, now })).resolves.toBeDefined();
});

it('reads headers case-insensitively from a plain object and takes the first of an array', async () => {
  const { body, headers } = signed();
  const upper = { 'Webhook-Id': [headers['webhook-id']], 'WEBHOOK-TIMESTAMP': headers['webhook-timestamp'], 'Webhook-Signature': headers['webhook-signature'] };
  await expect(verifyWebhook(body, upper, { secret, now })).resolves.toBeDefined();
});

// Review Focus 2: the exact bytes are hashed.
it('hashes raw bytes, including bytes that are not valid UTF-8', async () => {
  const id = `evt_${'2'.repeat(32)}`;
  const raw = Buffer.concat([Buffer.from(`{"id":"${id}","type":"test.event","timestamp":"t","data":{"message":"`), Buffer.from([0xff, 0xfe]), Buffer.from('"}}')]);
  const headers = { 'webhook-id': id, 'webhook-timestamp': String(NOW), 'webhook-signature': `v1,${sign(secret, id, NOW, raw)}` };
  const event = await verifyWebhook(new Uint8Array(raw), headers, { secret, now });
  expect(event.type).toBe('test.event');
  // A string round trip of the same bytes changes them, so it must NOT verify:
  expect(await reason(verifyWebhook(raw.toString('utf8'), headers, { secret, now }))).toBe('no_matching_signature');
});

it('accepts any matching v1 signature during a secret roll, with either secret configured', async () => {
  const { body, headers } = signed({ keys: [other, secret] });
  await expect(verifyWebhook(body, headers, { secret, now })).resolves.toBeDefined();
  await expect(verifyWebhook(body, headers, { secret: [other], now })).resolves.toBeDefined();
});

// Review Focus 3: unknown versions are ignored, never trusted.
it('ignores unknown signature versions and garbage next to a valid v1', async () => {
  const { body, headers } = signed({ extra: 'v2,AAAA garbage v1,' });
  await expect(verifyWebhook(body, headers, { secret, now })).resolves.toBeDefined();
});

it('rejects a header with only a non-v1 signature', async () => {
  const { body, headers } = signed();
  const v2 = { ...headers, 'webhook-signature': headers['webhook-signature'].replace('v1,', 'v2,') };
  expect(await reason(verifyWebhook(body, v2, { secret, now }))).toBe('no_matching_signature');
});

it.each([
  ['webhook-id'], ['webhook-timestamp'], ['webhook-signature'],
])('fails with missing_headers when %s is absent', async (name) => {
  const { body, headers } = signed();
  const without = { ...headers, [name]: '' };
  expect(await reason(verifyWebhook(body, without, { secret, now }))).toBe('missing_headers');
});

it('enforces the tolerance in both directions', async () => {
  for (const ts of [NOW - 301, NOW + 301]) {
    const { body, headers } = signed({ ts });
    expect(await reason(verifyWebhook(body, headers, { secret, now }))).toBe('timestamp_out_of_tolerance');
  }
  const { body, headers } = signed({ ts: NOW - 299 });
  await expect(verifyWebhook(body, headers, { secret, now })).resolves.toBeDefined();
  const bad = { ...headers, 'webhook-timestamp': '12x' };
  expect(await reason(verifyWebhook(body, bad, { secret, now }))).toBe('timestamp_out_of_tolerance');
});

it('refuses a tolerance of zero or less', async () => {
  const { body, headers } = signed();
  await expect(verifyWebhook(body, headers, { secret, now, toleranceSeconds: 0 })).rejects.toThrow(/toleranceSeconds/);
});

it('rejects a tampered body and a wrong secret', async () => {
  const { body, headers } = signed();
  expect(await reason(verifyWebhook(body.replace('fian_ord_1', 'fian_ord_2'), headers, { secret, now }))).toBe('no_matching_signature');
  expect(await reason(verifyWebhook(body, headers, { secret: other, now }))).toBe('no_matching_signature');
});

it.each(['sk_nope', 'whsec_', 'whsec_!!!notbase64'])('rejects the secret %j', async (bad) => {
  const { body, headers } = signed();
  expect(await reason(verifyWebhook(body, headers, { secret: bad, now }))).toBe('invalid_secret');
});

it('reads FIANTO_WEBHOOK_SECRET when no secret is passed', async () => {
  vi.stubEnv('FIANTO_WEBHOOK_SECRET', secret);
  const { body, headers } = signed();
  await expect(verifyWebhook(body, headers, { now })).resolves.toBeDefined();
  // This unstub is load-bearing for the next assertion (proving the fallback stops applying),
  // not just cleanup — afterEach's unstubAllEnvs() is the safety net for the cleanup case.
  vi.unstubAllEnvs();
  expect(await reason(verifyWebhook(body, headers, { now }))).toBe('invalid_secret');
});

it('rejects a body whose id differs from the webhook-id header', async () => {
  const id = `evt_${'3'.repeat(32)}`;
  const body = JSON.stringify(envelope(`evt_${'4'.repeat(32)}`));
  const headers = { 'webhook-id': id, 'webhook-timestamp': String(NOW), 'webhook-signature': `v1,${sign(secret, id, NOW, body)}` };
  expect(await reason(verifyWebhook(body, headers, { secret, now }))).toBe('invalid_payload');
});

it('accepts the verification probe, which has no id in its body', async () => {
  const id = `evt_${'5'.repeat(32)}`;
  const body = JSON.stringify({ type: 'endpoint.verification', timestamp: 't', data: { challenge: 'abc' } });
  const headers = { 'webhook-id': id, 'webhook-timestamp': String(NOW), 'webhook-signature': `v1,${sign(secret, id, NOW, body)}` };
  await expect(verifyWebhook(body, headers, { secret, now })).resolves.toEqual({ type: 'endpoint.verification', timestamp: 't', data: { challenge: 'abc' } });
});

it('rejects a signed body that is not a JSON event', async () => {
  for (const body of ['not json', '[]', '{"id":"x"}']) {
    const id = 'x';
    const headers = { 'webhook-id': id, 'webhook-timestamp': String(NOW), 'webhook-signature': `v1,${sign(secret, id, NOW, body)}` };
    expect(await reason(verifyWebhook(body, headers, { secret, now }))).toBe('invalid_payload');
  }
});

it('returns an unknown event type as-is', async () => {
  const id = `evt_${'6'.repeat(32)}`;
  const body = JSON.stringify({ id, type: 'invoice.created', timestamp: 't', data: { x: 1 } });
  const headers = { 'webhook-id': id, 'webhook-timestamp': String(NOW), 'webhook-signature': `v1,${sign(secret, id, NOW, body)}` };
  await expect(verifyWebhook(body, headers, { secret, now })).resolves.toMatchObject({ type: 'invoice.created' });
});

it('refuses a non-finite toleranceSeconds', async () => {
  const { body, headers } = signed();
  await expect(verifyWebhook(body, headers, { secret, now, toleranceSeconds: Infinity })).rejects.toThrow(/toleranceSeconds/);
  await expect(verifyWebhook(body, headers, { secret, now, toleranceSeconds: Number.NaN })).rejects.toThrow(/toleranceSeconds/);
});

it('refuses a parsed body with a clear FiantoError', async () => {
  const { body, headers } = signed();
  const error = await verifyWebhook(JSON.parse(body) as never, headers, { secret, now }).catch((e) => e);
  expect(error).not.toBeInstanceOf(WebhookVerificationError);
  expect(String(error.message)).toBe('verifyWebhook needs the raw request body (string or bytes), not parsed JSON');
});

it('accepts any Headers-like object with a get function', async () => {
  const { body, headers } = signed();
  const like = { get: (name: string) => (headers as Record<string, string>)[name] ?? null };
  await expect(verifyWebhook(body, like as never, { secret, now })).resolves.toBeDefined();
});

it('honours options.now far from the real clock', async () => {
  const past = NOW - 86_400;
  const { body, headers } = signed({ ts: past });
  await expect(verifyWebhook(body, headers, { secret, now: () => past * 1000 })).resolves.toBeDefined();
  expect(await reason(verifyWebhook(body, headers, { secret }))).toBe('timestamp_out_of_tolerance');
});

// C14: a short key or an unbounded tolerance is a configuration mistake, refused outright.
it('rejects a secret whose key is shorter than 16 bytes and accepts one of exactly 16', async () => {
  const short = `whsec_${randomBytes(15).toString('base64')}`;
  const { body, headers } = signed({ keys: [short] });
  expect(await reason(verifyWebhook(body, headers, { secret: short, now }))).toBe('invalid_secret');
  const sixteen = `whsec_${randomBytes(16).toString('base64')}`;
  const ok = signed({ keys: [sixteen] });
  await expect(verifyWebhook(ok.body, ok.headers, { secret: sixteen, now })).resolves.toBeDefined();
});

it('refuses a toleranceSeconds outside 1…3600', async () => {
  const { body, headers } = signed();
  for (const toleranceSeconds of [0.5, 3601, 1e12]) {
    await expect(verifyWebhook(body, headers, { secret, now, toleranceSeconds })).rejects.toThrow(/toleranceSeconds/);
  }
  for (const toleranceSeconds of [1, 3600]) {
    await expect(verifyWebhook(body, headers, { secret, now, toleranceSeconds })).resolves.toBeDefined();
  }
});

// C2: bounded work per request, whatever the signature header holds.
it('computes the HMAC once per secret, however many candidates the header carries', async () => {
  const sign = vi.spyOn(crypto.subtle, 'sign');
  const junk = Array.from({ length: 7 }, () => `v1,${randomBytes(32).toString('base64')}`).join(' ');
  const { body, headers } = signed({ keys: [secret], extra: junk });
  await expect(verifyWebhook(body, headers, { secret: [other, secret], now })).resolves.toBeDefined();
  expect(sign).toHaveBeenCalledTimes(2);
});

it('rejects more than 8 v1 candidates, even when one of them matches', async () => {
  const junk = Array.from({ length: 8 }, () => `v1,${randomBytes(32).toString('base64')}`).join(' ');
  const { body, headers } = signed({ extra: junk });
  expect(await reason(verifyWebhook(body, headers, { secret, now }))).toBe('invalid_signature_header');
  const eight = signed({ extra: junk.split(' ').slice(1).join(' ') });
  await expect(verifyWebhook(eight.body, eight.headers, { secret, now })).resolves.toBeDefined();
});

it('rejects a webhook-signature header longer than 4 KiB', async () => {
  const { body, headers } = signed({ extra: `v2,${'A'.repeat(4096)}` });
  expect(await reason(verifyWebhook(body, headers, { secret, now }))).toBe('invalid_signature_header');
});

it('skips candidates that do not decode to 32 bytes (a truncated MAC never matches)', async () => {
  const { body, headers } = signed();
  const mac = Buffer.from(headers['webhook-signature'].slice(3), 'base64');
  const truncated = { ...headers, 'webhook-signature': `v1,${mac.subarray(0, 16).toString('base64')}` };
  expect(await reason(verifyWebhook(body, truncated, { secret, now }))).toBe('no_matching_signature');
});
