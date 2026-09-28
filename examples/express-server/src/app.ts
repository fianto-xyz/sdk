import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkout, webhooks } from '@fianto/express';
import type { Fianto } from '@fianto/sdk';
import express, { type Express } from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

interface Plan {
  amount: string;
}

// Decide price server-side, never from the request body — see @fianto/sdk's README
// ("Checkout route").
const PLANS: Record<string, Plan> = {
  pro: { amount: '10.00' },
};

/** The real installed @fianto/js package's dist, not this workspace's source alias. */
function defaultScriptPath(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('@fianto/js/package.json');
  return join(dirname(packageJsonPath), 'dist', 'fianto-button.global.iife.js');
}

function cookieValue(request: Request, name: string): string | undefined {
  for (const pair of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export interface CreateAppOptions {
  /** Default: new Fianto() from FIANTO_* env vars, created on the first checkout request. */
  fianto?: Fianto;
  /** Default: process.env.FIANTO_WEBHOOK_SECRET. */
  webhookSecret?: string;
  /** Default: the real @fianto/js dist bundle. Override in tests to avoid depending on a build. */
  scriptPath?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // Both routes below need the EXACT bytes of the request body (webhook signature
  // verification, and checkout's own body read) — mount them before any body-parsing
  // middleware. See @fianto/express's README ("Mount before a body parser").
  app.post(
    '/webhooks/fianto',
    webhooks({
      secret: options.webhookSecret ?? process.env.FIANTO_WEBHOOK_SECRET,
      onOrderPaid: async (event) => {
        // Delivery is at-least-once and unordered: this callback WILL be called more than
        // once for the same event.id. Dedupe on event.id inside the SAME database transaction
        // as the fulfilment write — see @fianto/sdk's README ("Dedupe in the same transaction
        // as the side effect") — instead of fulfilling here directly.
        console.log('order paid', event.data.order_id);
      },
      onSubscriptionRenewed: async (event) => {
        // Same idempotency requirement as above: dedupe on event.id before extending access.
        console.log('subscription renewed', event.data.id);
      },
      onEvent: (event) => {
        console.log('fianto event', event.type);
      },
    }),
  );

  app.post(
    '/api/checkout',
    checkout({
      fianto: options.fianto,
      createSession: async (request) => {
        const body = (await request.json().catch(() => null)) as { plan?: string } | null;
        const plan = body?.plan;
        const chosen = plan ? PLANS[plan] : undefined;
        if (!chosen) return new Response('Unknown plan', { status: 400 });

        // DEMO ONLY: a real app reads the authenticated user's id from its own session, not a
        // plain unsigned cookie — see the Next.js example's app/api/checkout/route.ts for the
        // same pattern. Deriving order_id from a stable per-visitor id (rather than a
        // timestamp) keeps repeat clicks pointed at the same order, so
        // createCheckoutHandler reissues the existing session's link instead of creating a
        // new, colliding order on every click.
        const userId = cookieValue(request, 'uid') ?? 'demo-user';
        const origin = new URL(request.url).origin;
        return {
          mode: 'payment',
          order_id: `order_${userId}_${plan}`,
          amount: chosen.amount,
          success_url: `${origin}/thank-you.html`,
          cancel_url: `${origin}/`,
        };
      },
    }),
  );

  // A body parser for any OTHER routes is fine after this point — see "Mount before a body
  // parser" above for why it can't go any earlier.
  app.use(express.json());

  app.get('/fianto-button.js', (_req, res) => {
    const scriptPath = options.scriptPath ?? defaultScriptPath();
    res.type('application/javascript').send(readFileSync(scriptPath));
  });

  app.use(express.static(PUBLIC_DIR));

  return app;
}
