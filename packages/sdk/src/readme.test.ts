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

/**
 * Claims the facts register forbids, matched over the text with every run of whitespace (line
 * breaks included) collapsed to one space, since the READMEs are hard-wrapped.
 */
const FORBIDDEN = [
  /instant payouts?/i,
  // Not a way to pay through fianto (no R3 row): forbidden in any wording; see ALLOWED.
  /(apple|google)\s+pay/i,
  /always works/i,
  /capped at 10%/i,
  /no chargebacks?/i,
  /pays nothing(?! to Fianto)/i,
  // Stripe does charge a fee on a card payment: say "no Fianto fee".
  /\bno fee\b/i,
  /=== 'crypto'/,
];

/** The exact sentences allowed to match FORBIDDEN, each with its file and reason. */
const ALLOWED = [
  {
    path: 'packages/js/README.md',
    // Other brands' own buttons, named for why fianto's button is locked; not a way to pay.
    text: 'Like PayPal, Apple Pay, Google Pay and Shop Pay lock their own buttons',
  },
];

/** The forbidden claims in one README's text, after the allowed sentences are taken out. */
function forbiddenIn(path: string, markdown: string): string[] {
  let text = markdown.replace(/\s+/g, ' ');
  for (const allowed of ALLOWED) if (allowed.path === path) text = text.replace(allowed.text, '');
  return FORBIDDEN.filter((pattern) => pattern.test(text)).map(String);
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
    for (const path of readmes()) expect(forbiddenIn(path, read(path)), path).toEqual([]);
  });

  it('catches a forbidden claim across a line break, and allows only the exact allowed sentence', () => {
    expect(forbiddenIn('packages/sdk/README.md', 'Checkout can accept cards and\nApple Pay.')).toEqual(['/(apple|google)\\s+pay/i']);
    expect(forbiddenIn('packages/sdk/README.md', 'Payers can use Google\n  Pay too.')).toEqual(['/(apple|google)\\s+pay/i']);
    expect(forbiddenIn('packages/sdk/README.md', 'A card sample has no\nfee.')).toEqual(['/\\bno fee\\b/i']);
    // The allowed sentence is allowed in its own file only, and nothing else in that file is.
    const js = 'Like PayPal, Apple Pay, Google Pay and Shop Pay lock their own buttons, `<fianto-button>` locks';
    expect(forbiddenIn('packages/js/README.md', js)).toEqual([]);
    expect(forbiddenIn('packages/react/README.md', js)).toEqual(['/(apple|google)\\s+pay/i']);
    expect(forbiddenIn('packages/js/README.md', `${js}. Pay by Apple Pay.`)).toEqual(['/(apple|google)\\s+pay/i']);
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
      for (const line of text.split('\n').filter((l) => /timestamp/i.test(l))) expect(line).toMatch(/\b(never|not)\b/i);
    });

    it('says when to re-seed, in the same words as refundDelta', () => {
      const sentence = 'If your total differs from `refunded_amount` while none of that payment\'s events is in flight, re-seed it from `GET /v1/payments/{id}`.';
      expect(card().replace(/\s+/g, ' ')).toContain(sentence);
      const jsdoc = read('packages/sdk/src/webhooks/refund-delta.ts').replace(/\n\s*\* ?/g, ' ').replace(/\s+/g, ' ');
      expect(jsdoc).toContain(sentence);
    });

    it('gives every meaning of dispute_lost and reversed', () => {
      const text = card().replace(/\s+/g, ' ');
      expect(text).toMatch(/`dispute_lost` \(a card dispute was lost, or a lost dispute's amount went up\)/);
      expect(text).toMatch(/`reversed` \(a lost dispute was won late, or a lost dispute's amount went down\)/);
    });

    it('falls back to crypto when no card can be offered, and rethrows anything else', () => {
      const text = card();
      const branch = text.slice(text.indexOf("if (isFiantoError(err, 'payment_method_unavailable'))"));
      expect(branch.slice(0, branch.indexOf('```'))).toMatch(/payment_methods: \['crypto'\][\s\S]*\} else \{\s*throw err;/);
    });

    it('retries the SAME order_id after a refused create, which made nothing', () => {
      const text = card();
      const snippet = text.slice(text.indexOf('```ts'), text.indexOf('```', text.indexOf('```ts') + 5));
      const orderIds = [...snippet.matchAll(/order_id: '([^']+)'/g)].map((match) => match[1]);
      expect(orderIds).toEqual(['order_1001', 'order_1001']);
      expect(text).not.toContain('order_1001-crypto');
      expect(text.replace(/\s+/g, ' ')).toMatch(/refused create makes nothing[^.]*same `order_id`/);
      // Different methods on an order that already exists still need a new order_id.
      expect(text.replace(/\s+/g, ' ')).toContain('Changing the methods of an existing order needs a new `order_id`.');
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
  const changeset = () => read('.changeset/card-payments.md');

  it('bumps @fianto/sdk minor (the fixed group bumps every package with it)', () => {
    expect(changeset()).toMatch(/^---\n"@fianto\/sdk": minor\n---\n/);
  });

  it('says event payments need gateway and method only on the card branch', () => {
    const text = changeset().replace(/\s+/g, ' ');
    expect(text).not.toContain("or an event's `payment` now need");
    expect(text).toContain("An event's `payment` needs them only on the card branch");
  });

  it('counts the webhook payloads in the currency widening', () => {
    expect(changeset().replace(/\s+/g, ' ')).toMatch(/`currency` widens[^.]*and their webhook payloads/);
  });
});
