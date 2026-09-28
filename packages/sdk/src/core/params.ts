/**
 * Several write methods (`checkoutSessions.cancel`/`reissueLink`, `webhookEndpoint.sendTestEvent`)
 * take a reserved `params` slot that is empty today, so a future body field is additive instead
 * of a signature change (F6). Forwarding it unconditionally would send an empty `{}` body (and
 * its `content-type` header) where none was sent before; this keeps that wire behaviour
 * unchanged until the slot's type actually gains a field.
 */
export function bodyOf<T extends object>(params: T): T | undefined {
  return Object.keys(params).length > 0 ? params : undefined;
}
