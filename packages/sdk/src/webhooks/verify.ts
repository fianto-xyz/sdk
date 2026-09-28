import { FiantoError } from '../core/errors.js';
import { base64ToBytes } from './base64.js';
import { WebhookVerificationError } from './errors.js';
import type { WebhookEvent } from './events.js';
import { readHeader, type HeadersLike } from './headers.js';

export interface VerifyOptions {
  /**
   * One secret, or several during a roll: `whsec_` + base64 of a key of at least 16 bytes.
   * Default: process.env.FIANTO_WEBHOOK_SECRET.
   */
  secret?: string | readonly string[];
  /** Default 300. Between 1 and 3600: replay protection can be neither switched off nor made meaningless. */
  toleranceSeconds?: number;
  /** Current time in ms (tests). */
  now?: () => number;
}

const SECRET_PREFIX = 'whsec_';
const MIN_KEY_BYTES = 16;
const DEFAULT_TOLERANCE_SECONDS = 300;
const MAX_TOLERANCE_SECONDS = 3600;
/** C2: bounds the work an unauthenticated request can cause, whatever its signature header holds. */
const MAX_SIGNATURE_HEADER_LENGTH = 4096;
const MAX_CANDIDATES = 8;
const MAC_BYTES = 32;
const encoder = new TextEncoder();

/**
 * The three signature headers, checked and parsed. Everything here is read before the body, so
 * a request with no chance of verifying is refused without reading it.
 * @internal
 */
export interface SignedHeaders {
  id: string;
  timestamp: string;
  /** The `v1,` candidates that decode to exactly 32 bytes (the others can never match). */
  candidates: Uint8Array[];
}

/** @internal `toleranceSeconds` validated, or the default. Throws a configuration error. */
export function resolveTolerance(value: number | undefined): number {
  const tolerance = value ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isFinite(tolerance) || tolerance < 1 || tolerance > MAX_TOLERANCE_SECONDS) {
    throw new FiantoError(`toleranceSeconds must be a number between 1 and ${MAX_TOLERANCE_SECONDS}.`);
  }
  return tolerance;
}

function envSecret(): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FIANTO_WEBHOOK_SECRET || undefined;
}

/**
 * @internal The raw HMAC keys of `secret` (else FIANTO_WEBHOOK_SECRET), validated: `whsec_` +
 * base64 of at least 16 bytes. Throws `WebhookVerificationError('invalid_secret')`.
 */
export function secretKeys(secret: string | readonly string[] | undefined): Uint8Array<ArrayBuffer>[] {
  const value = secret ?? envSecret();
  const secrets = typeof value === 'string' ? [value] : value ?? [];
  if (secrets.length === 0) {
    throw new WebhookVerificationError('invalid_secret', 'No webhook secret: pass options.secret or set FIANTO_WEBHOOK_SECRET.');
  }
  return secrets.map((entry) => {
    const raw = typeof entry === 'string' && entry.startsWith(SECRET_PREFIX) ? base64ToBytes(entry.slice(SECRET_PREFIX.length)) : null;
    if (!raw || raw.length < MIN_KEY_BYTES) {
      throw new WebhookVerificationError('invalid_secret', `A webhook secret must be whsec_ followed by base64 of at least ${MIN_KEY_BYTES} bytes.`);
    }
    return raw;
  });
}

/**
 * @internal Checks that the three headers exist, the signature header is within bounds and the
 * timestamp is within `toleranceSeconds` of `nowMs`. Never looks at the body.
 */
export function readSignedHeaders(headers: HeadersLike, toleranceSeconds: number, nowMs: number): SignedHeaders {
  const id = readHeader(headers, 'webhook-id');
  const timestamp = readHeader(headers, 'webhook-timestamp');
  const signature = readHeader(headers, 'webhook-signature');
  if (!id || !timestamp || !signature) {
    throw new WebhookVerificationError('missing_headers', 'webhook-id, webhook-timestamp and webhook-signature are required.');
  }
  if (signature.length > MAX_SIGNATURE_HEADER_LENGTH) {
    throw new WebhookVerificationError('invalid_signature_header', `The webhook-signature header is longer than ${MAX_SIGNATURE_HEADER_LENGTH} characters.`);
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) {
    throw new WebhookVerificationError('timestamp_out_of_tolerance', 'The webhook timestamp is missing, malformed or too old/new.');
  }
  const v1 = signature.split(' ').filter((part) => part.startsWith('v1,')).map((part) => part.slice(3));
  if (v1.length > MAX_CANDIDATES) {
    throw new WebhookVerificationError('invalid_signature_header', `The webhook-signature header carries more than ${MAX_CANDIDATES} v1 signatures.`);
  }
  const candidates = v1
    .map((value) => base64ToBytes(value))
    .filter((bytes): bytes is Uint8Array<ArrayBuffer> => bytes !== null && bytes.length === MAC_BYTES);
  return { id, timestamp, candidates };
}

/** @internal What the MAC covers ahead of the body: `${id}.${timestamp}.` */
export function signedPrefix(signed: SignedHeaders): Uint8Array {
  return encoder.encode(`${signed.id}.${signed.timestamp}.`);
}

/** Constant-time for two 32-byte MACs: every byte is compared, whatever differs first. */
function sameMac(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < MAC_BYTES; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * @internal Verifies `content` (the signed prefix followed by the body, starting at `bodyOffset`)
 * and parses the event. One HMAC per key, then a constant-time compare per candidate.
 */
export async function verifySignedContent(
  content: Uint8Array<ArrayBuffer>,
  bodyOffset: number,
  signed: SignedHeaders,
  keys: readonly Uint8Array<ArrayBuffer>[],
): Promise<WebhookEvent> {
  let matched = false;
  for (const raw of keys) {
    const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, content));
    for (const candidate of signed.candidates) {
      if (sameMac(mac, candidate)) matched = true;
    }
  }
  if (!matched) throw new WebhookVerificationError('no_matching_signature', 'No webhook signature matched.');

  let event: unknown;
  try {
    event = JSON.parse(new TextDecoder().decode(content.subarray(bodyOffset)));
  } catch {
    throw new WebhookVerificationError('invalid_payload', 'The webhook body is not JSON.');
  }
  const record = event as { id?: unknown; type?: unknown };
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof record.type !== 'string') {
    throw new WebhookVerificationError('invalid_payload', 'The webhook body is not an event.');
  }
  if (record.type !== 'endpoint.verification' && record.id !== signed.id) {
    throw new WebhookVerificationError('invalid_payload', 'The event id does not match the webhook-id header.');
  }
  return event as WebhookEvent;
}

/** One buffer holding `prefix` then `body`: the only copy of the body verification makes. */
function signedContent(prefix: Uint8Array, body: string | Uint8Array | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const bytes = typeof body === 'string' ? encoder.encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body);
  const content = new Uint8Array(prefix.length + bytes.length);
  content.set(prefix);
  content.set(bytes, prefix.length);
  return content;
}

/**
 * Verifies a Standard Webhooks signature over the raw body and returns the parsed event.
 * Pass the body exactly as received (never re-serialised JSON).
 *
 * The result is typed as the known union (`WebhookEvent`), so `switch (event.type)` narrows
 * `event.data`. An event type newer than this SDK is still returned at runtime: give every
 * switch a `default:` branch, or check `isKnownEventType(event.type)` first.
 */
export async function verifyWebhook(
  rawBody: string | Uint8Array | ArrayBuffer,
  headers: HeadersLike,
  options: VerifyOptions = {},
): Promise<WebhookEvent> {
  const tolerance = resolveTolerance(options.toleranceSeconds);
  if (typeof rawBody !== 'string' && !(rawBody instanceof Uint8Array) && !(rawBody instanceof ArrayBuffer)) {
    throw new FiantoError('verifyWebhook needs the raw request body (string or bytes), not parsed JSON');
  }
  const signed = readSignedHeaders(headers, tolerance, options.now?.() ?? Date.now());
  const keys = secretKeys(options.secret);
  const prefix = signedPrefix(signed);
  return verifySignedContent(signedContent(prefix, rawBody), prefix.length, signed, keys);
}
