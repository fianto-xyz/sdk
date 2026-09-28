import { cookies } from 'next/headers';
import { Checkout } from '@fianto/nextjs';

interface Plan {
  priceId: string | undefined;
}

/**
 * The public origin `success_url`/`cancel_url` are built from. Trusting `request.url`/the `Host`
 * header instead would let whatever a reverse proxy (or a forged header) put there choose where
 * the payer lands, and fianto's own API refuses an http `success_url`/`cancel_url` in production
 * anyway. Set `SITE_URL` once you deploy; falling back to the request's own origin is a
 * local-development convenience only.
 */
function siteOrigin(request: Request): string {
  const configured = process.env.SITE_URL;
  if (configured) {
    const url = new URL(configured);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('SITE_URL must be https:// in production.');
    }
    return url.origin;
  }
  return new URL(request.url).origin;
}

// Decide price server-side, never from the request body — see @fianto/sdk's README
// ("Checkout route"). Real prices/products are created once against the fianto API and
// referenced here by id; FIANTO_PRICE_PRO is that price's id for this deployment.
const PLANS: Record<string, Plan> = {
  pro: { priceId: process.env.FIANTO_PRICE_PRO },
};

export const POST = Checkout({
  createSession: async (request) => {
    const body = (await request.json().catch(() => null)) as { plan?: string } | null;
    const plan = body?.plan;
    const chosen = plan ? PLANS[plan] : undefined;
    if (!chosen) return new Response('Unknown plan', { status: 400 });
    // `price_id` must be a string, not `string | undefined` — a real deployment sets
    // FIANTO_PRICE_PRO; this refuses to start a checkout that can't succeed either way.
    if (!chosen.priceId) return new Response('Plan not configured', { status: 500 });

    // DEMO ONLY: a real app reads the authenticated user's id from its own session, not a
    // plain unsigned cookie. This stands in for that so the order_id below is stable and
    // unique per user+plan across repeat attempts.
    const jar = await cookies();
    const userId = jar.get('uid')?.value ?? 'demo-user';

    const origin = siteOrigin(request);
    return {
      mode: 'subscription',
      order_id: `sub_${userId}_${plan}`,
      price_id: chosen.priceId,
      success_url: `${origin}/thank-you`,
      cancel_url: `${origin}/`,
    };
  },
});
