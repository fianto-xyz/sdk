import { FiantoError } from '../core/errors.js';
import { base64ToBytes } from './base64.js';
import { WebhookVerificationError } from './errors.js';
import type { UnknownWebhookEvent, WebhookEvent } from './events.js';
import { readHeader, type HeadersLike } from './headers.js';

export interface VerifyOptions {
  /** One secret, or several during a roll. Default: process.env.FIANTO_WEBHOOK_SECRET. */
  secret?: string | readonly string[];
  /** Default 300. Must be > 0: replay protection cannot be switched off. */
  toleranceSeconds?: number;
  /** Current time in ms (tests). */
  now?: () => number;
}

const SECRET_PREFIX = 'whsec_';
const encoder = new TextEncoder();

function toBytes(body: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof body === 'string') return encoder.encode(body);
  return body instanceof Uint8Array ? body : new Uint8Array(body);
}

async function importKeys(secret: string | readonly string[] | undefined): Promise<CryptoKey[]> {
  const secrets = typeof secret === 'string' ? [secret] : secret ?? [];
  if (secrets.length === 0) {
    throw new WebhookVerificationError('invalid_secret', 'No webhook secret: pass options.secret or set FIANTO_WEBHOOK_SECRET.');
  }
  return Promise.all(
    secrets.map((value) => {
      const raw = value.startsWith(SECRET_PREFIX) ? base64ToBytes(value.slice(SECRET_PREFIX.length)) : null;
      if (!raw || raw.length === 0) {
        throw new WebhookVerificationError('invalid_secret', 'A webhook secret must be whsec_ followed by base64.');
      }
      return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    }),
  );
}

function envSecret(): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FIANTO_WEBHOOK_SECRET || undefined;
}

/**
 * Verifies a Standard Webhooks signature over the raw body and returns the parsed event.
 * Pass the body exactly as received (never re-serialised JSON).
 */
export async function verifyWebhook(
  rawBody: string | Uint8Array | ArrayBuffer,
  headers: HeadersLike,
  options: VerifyOptions = {},
): Promise<WebhookEvent | UnknownWebhookEvent> {
  const tolerance = options.toleranceSeconds ?? 300;
  if (!(tolerance > 0)) throw new FiantoError('toleranceSeconds must be greater than 0.');

  const id = readHeader(headers, 'webhook-id');
  const timestamp = readHeader(headers, 'webhook-timestamp');
  const signature = readHeader(headers, 'webhook-signature');
  if (!id || !timestamp || !signature) {
    throw new WebhookVerificationError('missing_headers', 'webhook-id, webhook-timestamp and webhook-signature are required.');
  }
  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > tolerance) {
    throw new WebhookVerificationError('timestamp_out_of_tolerance', 'The webhook timestamp is missing, malformed or too old/new.');
  }

  const keys = await importKeys(options.secret ?? envSecret());
  const body = toBytes(rawBody);
  const prefix = encoder.encode(`${id}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);

  const candidates = signature
    .split(' ')
    .map((part) => part.split(','))
    .filter(([version, value]) => version === 'v1' && value)
    .map(([, value]) => base64ToBytes(value!))
    .filter((bytes): bytes is Uint8Array<ArrayBuffer> => bytes !== null);
  let matched = false;
  for (const key of keys) {
    for (const candidate of candidates) {
      if (await crypto.subtle.verify('HMAC', key, candidate, signed)) matched = true;
    }
  }
  if (!matched) throw new WebhookVerificationError('no_matching_signature', 'No webhook signature matched.');

  let event: unknown;
  try {
    event = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new WebhookVerificationError('invalid_payload', 'The webhook body is not JSON.');
  }
  const record = event as { id?: unknown; type?: unknown };
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof record.type !== 'string') {
    throw new WebhookVerificationError('invalid_payload', 'The webhook body is not an event.');
  }
  if (record.type !== 'endpoint.verification' && record.id !== id) {
    throw new WebhookVerificationError('invalid_payload', 'The event id does not match the webhook-id header.');
  }
  return event as WebhookEvent | UnknownWebhookEvent;
}
