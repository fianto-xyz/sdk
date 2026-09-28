import { bytesToBase64 } from './base64.js';

export interface SignOptions {
  /** The envelope to send: { id?, type, timestamp, data }. */
  event: object;
  secret: string | readonly string[];
  /** Default: event.id, else a fresh evt_ id. */
  id?: string;
  /** Unix seconds. Default: now. */
  timestamp?: number;
  /**
   * The exact body bytes to sign and send, verbatim (e.g. a pretty-printed file's text). Must be
   * the JSON of `event`. Default: `JSON.stringify(event)`.
   */
  rawBody?: string;
}

const encoder = new TextEncoder();

/** Signs an event exactly as fianto does — for tests and local tooling. */
export async function signWebhook(options: SignOptions): Promise<{ body: string; headers: Record<string, string> }> {
  const body = options.rawBody ?? JSON.stringify(options.event);
  const eventId = (options.event as { id?: unknown }).id;
  const id = options.id ?? (typeof eventId === 'string' ? eventId : `evt_${crypto.randomUUID().replaceAll('-', '')}`);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const secrets = typeof options.secret === 'string' ? [options.secret] : options.secret;
  const signatures = await Promise.all(
    secrets.map(async (secret) => {
      const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${body}`));
      return `v1,${bytesToBase64(new Uint8Array(mac))}`;
    }),
  );
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Fianto-Webhooks/1.0',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signatures.join(' '),
    },
  };
}
