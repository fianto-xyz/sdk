// The READMEs are part of the SDK's interface: the snippets are type-checked by
// scripts/check-readme-snippets.mjs, and this file pins what they must say (and never say) about
// events, errors and card payments, so they cannot drift from the code.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEBHOOK_EVENT_TYPES } from './webhooks/events.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Every README this repo publishes or shows: the root one, each package's and each example's. */
function readmes(): string[] {
  const inDir = (dir: string) =>
    readdirSync(join(ROOT, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${dir}/${entry.name}/README.md`)
      .filter((path) => {
        try {
          read(path);
          return true;
        } catch {
          return false;
        }
      });
  return ['README.md', ...inDir('packages'), ...inDir('examples')];
}

const SDK = read('packages/sdk/README.md');

/** The text of one `## ` section of a README, up to the next `## ` heading. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`no "## ${heading}" section`);
  const end = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
}

const callbackOf = (type: string) => `on${type.split(/[._]/).map((word) => word[0]!.toUpperCase() + word.slice(1)).join('')}`;

describe('every README', () => {
  it('calls the cart total total, not totalUsdc (it is USD for card)', () => {
    for (const path of readmes()) expect(read(path), path).not.toContain('totalUsdc');
  });

  it('comments every cart amount as a decimal USD price for both rails', () => {
    const comment = '// decimal USD price, e.g. "10.00" (USDC 1:1 for crypto, USD for card)';
    for (const path of readmes()) {
      for (const line of read(path).split('\n').filter((l) => /amount: cart\.total\b/.test(l))) {
        expect(line.trim(), path).toBe(`amount: cart.total, ${comment}`);
      }
    }
  });

  it('never states a claim the facts register forbids', () => {
    const forbidden = [
      /instant payouts?/i,
      // Named only as other brands' buttons (js README), never as a way to pay through fianto.
      /(accept|support|offer|pay with|pay by)[^.\n]*(apple|google) pay/i,
      /always works/i,
      /capped at 10%/i,
      /no chargebacks?/i,
      /pays nothing(?! to Fianto)/i,
      /=== 'crypto'/,
    ];
    for (const path of readmes()) {
      for (const pattern of forbidden) expect(read(path), `${path}: ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('@fianto/sdk README', () => {
  it('lists exactly the event types this SDK version knows', () => {
    const paragraph = SDK.slice(SDK.indexOf('**Event types:**'), SDK.indexOf('plus `endpoint.verification`'));
    const listed = [...paragraph.matchAll(/`([a-z_.]+)`/g)].map((match) => match[1]);
    expect(listed).toEqual([...WEBHOOK_EVENT_TYPES]);
  });

  it('names the callback of every event type', () => {
    for (const type of WEBHOOK_EVENT_TYPES) expect(SDK, type).toContain(`\`${callbackOf(type)}\``);
  });

  it('shows every error the SDK throws in the error tree', () => {
    const tree = section(SDK, 'Errors');
    for (const name of ['AmountError', 'UsdcError', 'RefundStatusError', 'WebhookVerificationError']) expect(tree, name).toContain(name);
    expect(tree).toContain("code: 'unknown_refund_status'");
    expect(tree).toContain('payment_method_unavailable');
  });

  it('presents Currency as what money.format takes', () => {
    expect(section(SDK, 'Amounts')).toMatch(/money\.format\(base, currency\)[^\n]*`Currency`/);
  });

  describe('Card payments', () => {
    const card = () => section(SDK, 'Card payments');

    it('creates both rails with one call and names the create error', () => {
      expect(card()).toContain('payment_methods');
      expect(card()).toContain("isFiantoError(err, 'payment_method_unavailable')");
      expect(card()).toContain('new `order_id`');
    });

    it('branches on method === card then else, and says why', () => {
      expect(card()).toContain("if (event.data.payment.method === 'card')");
      expect(card()).toMatch(/no `method` key/);
    });

    it('follows the payment.refunded contract', () => {
      const text = card();
      expect(text).toContain('refundDelta(event.data)');
      expect(text).toContain('GET /v1/payments/{id}');
      expect(text).toMatch(/once per event id/i);
      expect(text).toMatch(/never pair[^.]*`refund\.id`/i);
      expect(text).toMatch(/never undo[^.]*`dispute_lost`/i);
      expect(text).toMatch(/never sum `refund\.amount`/i);
      // The envelope timestamp is the app's insert clock: it may only appear in a "never" sentence.
      for (const line of text.split('\n').filter((l) => /timestamp/i.test(l))) expect(line).toMatch(/never|not/i);
    });

    it('links every Stripe fact it states to docs.stripe.com', () => {
      const text = card();
      for (const fact of ['Stripe keeps', 'holds the refund as pending', 'while the dispute is open', 'three-digit CVC']) {
        const sentence = text.slice(text.indexOf(fact));
        expect(text, fact).toContain(fact);
        expect(sentence.slice(0, sentence.indexOf('\n\n') === -1 ? undefined : sentence.indexOf('\n\n')), fact).toMatch(/https:\/\/docs\.stripe\.com\//);
      }
    });
  });
});

describe('the changeset', () => {
  it('bumps @fianto/sdk minor (the fixed group bumps every package with it)', () => {
    const changeset = read('.changeset/card-payments.md');
    expect(changeset).toMatch(/^---\n"@fianto\/sdk": minor\n---\n/);
  });
});
