import { FiantoError, isFiantoError } from '../core/errors.js';

export type WebhookVerificationFailure =
  | 'missing_headers'
  | 'timestamp_out_of_tolerance'
  | 'invalid_secret'
  | 'no_matching_signature'
  | 'invalid_payload';

export class WebhookVerificationError extends FiantoError {
  override name = 'WebhookVerificationError';
  constructor(readonly reason: WebhookVerificationFailure, message: string) {
    super(message);
  }
}

/**
 * Brand-based, cross-copy-safe check (see `isFiantoError`): true for a `WebhookVerificationError`
 * even one thrown by a different copy of this package, unlike `instanceof`.
 */
export function isWebhookVerificationError(error: unknown): error is WebhookVerificationError {
  return isFiantoError(error) && error.name === 'WebhookVerificationError';
}
