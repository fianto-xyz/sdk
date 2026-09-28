/**
 * The public origin `success_url`/`cancel_url` are built from. Trusting `request.url`/the `Host`
 * header instead would let whatever a reverse proxy (or a forged header) put there choose where
 * the payer lands, and fianto's own API refuses an http `success_url`/`cancel_url` in production
 * anyway. Set `SITE_URL` once you deploy — required and validated in production; falling back to
 * the incoming request's own origin is a local-development convenience only.
 */
export function siteOrigin(request: Request): string {
  const configured = process.env.SITE_URL;
  if (configured) {
    const url = new URL(configured);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('SITE_URL must be https:// in production.');
    }
    return url.origin;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SITE_URL must be set to your https:// public origin in production.');
  }
  // Local-development convenience only: never trusted in production (see above).
  return new URL(request.url).origin;
}
