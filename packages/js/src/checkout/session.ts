import { CheckoutSessionError, InvalidSessionError } from './errors.js';

export interface CheckoutSession { id: string; url: string }
export type CheckoutSessionSource = CheckoutSession | (() => Promise<CheckoutSession>);

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Resolves the source and checks the URL is somewhere a payer may safely be sent. */
export async function resolveSession(source: CheckoutSessionSource): Promise<CheckoutSession & { origin: string }> {
  const session = typeof source === 'function' ? await source() : source;
  // A route's `{ error: { code, message } }` body handed over as if it were a session (the
  // `fetch().then((r) => r.json())` pattern): keep its code rather than calling it invalid.
  const error = (session as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (error && typeof error.code === 'string') {
    throw new CheckoutSessionError(error.code, typeof error.message === 'string' ? error.message : 'Your checkout route refused to create a session.');
  }
  if (!session || typeof session.id !== 'string' || session.id === '' || typeof session.url !== 'string') {
    throw new InvalidSessionError('Expected { id, url } from your checkout route.');
  }
  let url: URL;
  try {
    url = new URL(session.url);
  } catch {
    throw new InvalidSessionError('The checkout url is not a valid URL.');
  }
  const ok = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL.has(url.hostname));
  if (!ok) throw new InvalidSessionError('The checkout url must be https:// (http:// only on localhost).');
  // Return the merchant's original url, not url.href: what we navigate to is exactly what the
  // server returned, never a normalised rewrite of it.
  return { id: session.id, url: session.url, origin: url.origin };
}
