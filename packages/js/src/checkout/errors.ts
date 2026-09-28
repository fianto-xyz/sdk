export class FiantoCheckoutError extends Error {
  override name = 'FiantoCheckoutError';
  constructor(readonly code: string, message: string) { super(message); }
}
export class PopupBlockedError extends FiantoCheckoutError {
  override name = 'PopupBlockedError';
  constructor() { super('popup_blocked', 'The browser blocked the checkout popup. Call openCheckout() directly inside a click handler.'); }
}
export class InvalidSessionError extends FiantoCheckoutError {
  override name = 'InvalidSessionError';
  constructor(message: string) { super('invalid_session', message); }
}
