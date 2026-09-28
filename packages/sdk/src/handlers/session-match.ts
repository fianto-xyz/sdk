import type { Fianto } from '../client.js';
import { FiantoError } from '../core/errors.js';
import { usdc } from '../amounts.js';
import type { CheckoutSession, CheckoutSessionCreateParams } from '../types.js';

/** A field of the checkout params whose value the order's open session does not carry. */
export type MismatchedField = 'mode' | 'ui_mode' | 'amount' | 'price_id';

/**
 * The order already has an OPEN checkout session whose terms differ from the ones just asked
 * for. `createCheckoutHandler` answers 409 `order_session_mismatch` and never cancels or
 * reissues it: a transaction the payer already built for the old session can still settle
 * after a cancel, so a cancel + recreate could charge the payer twice. Use a new `order_id` for
 * new terms (e.g. include a cart version), or cancel the old session yourself first.
 */
export class OrderSessionMismatchError extends FiantoError {
  override name = 'OrderSessionMismatchError';
  readonly code = 'order_session_mismatch';
  /** @internal Constructed only by `createCheckoutHandler`. */
  constructor(
    /** The open session's id (`fian_cs_…`). */
    readonly sessionId: string,
    /** Which of the params differ from it. */
    readonly fields: readonly MismatchedField[],
    orderId: string,
  ) {
    super(
      `Order ${orderId} already has an open checkout session (${sessionId}) with a different ${fields.join(', ')}. ` +
        'It was left untouched: use a new order_id for the new terms, or cancel that session first.',
    );
  }
}

function sameAmount(decimal: string, baseUnits: string): boolean {
  try {
    return usdc.toBaseUnits(decimal) === baseUnits;
  } catch {
    return false;
  }
}

/**
 * The params (as sent, with `ui_mode: 'popup'`) that the open `session` does not match.
 *
 * The session response echoes `mode`, `ui_mode`, `amount`, `currency` and `interval`, but not
 * `price_id` (nor `description`/`line_items`). A price_id checkout is therefore compared through
 * the price itself: prices are immutable apart from archiving, so the session was opened for
 * this price only if the price's amount, currency and interval all match the session's. Two
 * different prices with identical amount, currency and interval cannot be told apart this way.
 */
export async function mismatchedFields(
  client: Fianto,
  params: CheckoutSessionCreateParams,
  session: CheckoutSession,
): Promise<MismatchedField[]> {
  const fields: MismatchedField[] = [];
  if (session.mode !== params.mode) fields.push('mode');
  if (session.ui_mode !== 'popup') fields.push('ui_mode');
  if (params.amount !== undefined) {
    if (!sameAmount(params.amount, session.amount)) fields.push('amount');
  } else if (fields.length === 0) {
    // Only worth an API read when nothing else already rules the session out.
    const price = await client.prices.retrieve(params.price_id);
    if (price.amount !== session.amount || price.currency !== session.currency || price.interval !== session.interval) {
      fields.push('price_id');
    }
  }
  return fields;
}
