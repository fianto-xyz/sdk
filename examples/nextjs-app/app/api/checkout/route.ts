import { cookies } from 'next/headers';
import { Checkout } from '@fianto/nextjs';
import { siteOrigin } from '../../../src/site-origin.js';
import { subscribeOrderId } from '../../../src/subscribe-attempts.js';

interface Plan {
  priceId: string | undefined;
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
    if (!plan || !chosen) return new Response('Unknown plan', { status: 400 });
    // `price_id` must be a string, not `string | undefined` — a real deployment sets
    // FIANTO_PRICE_PRO; this refuses to start a checkout that can't succeed either way.
    if (!chosen.priceId) return new Response('Plan not configured', { status: 500 });

    // DEMO ONLY: a real app reads the authenticated user's id from its own session, not a
    // plain unsigned cookie.
    const jar = await cookies();
    const userId = jar.get('uid')?.value ?? 'demo-user';

    const origin = siteOrigin(request);
    return {
      mode: 'subscription',
      // The same order_id for the whole life of the user's subscription: a second click reuses
      // the open checkout, and while the subscription is live fianto refuses another subscribe
      // with 409 order_id_in_use. A new one only after subscription.ended. See
      // src/subscribe-attempts.ts.
      order_id: subscribeOrderId(userId, plan),
      price_id: chosen.priceId,
      success_url: `${origin}/thank-you`,
      cancel_url: `${origin}/`,
    };
  },
});
