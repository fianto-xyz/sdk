import { resolveSession, type CheckoutSessionSource } from './session.js';

/** Sends the whole page to hosted checkout. The returned promise never settles. */
export async function redirectToCheckout(session: CheckoutSessionSource): Promise<never> {
  const resolved = await resolveSession(session);
  window.location.assign(resolved.url);
  return new Promise<never>(() => {});
}
