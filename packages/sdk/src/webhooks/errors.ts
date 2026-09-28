import { FiantoError, isFiantoError } from '../core/errors.js';

export type WebhookVerificationFailure =
  | 'missing_headers'
  /** The webhook-signature header is over 4 KiB or carries more than 8 `v1,` signatures. */
  | 'invalid_signature_header'
  | 'timestamp_out_of_tolerance'
  | 'invalid_secret'
  | 'no_matching_signature'
  | 'invalid_payload'
  /** The webhook handler refused a body over its `maxBodyBytes` (answered 413). */
  | 'payload_too_large';

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
