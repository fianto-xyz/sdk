import { FiantoError, isFiantoError } from '../core/errors.js';

export type WebhookVerificationFailure =
  | 'missing_headers'
  /** The webhook-signature header is over 4 KiB or carries more than 8 `v1,` signatures. */
  | 'invalid_signature_header'
  | 'timestamp_out_of_tolerance'
  | 'invalid_secret'
  | 'no_matching_signature'
  | 'invalid_payload'
  /** `verifyWebhook` was given `network` and the event's `network` is different, or absent (a backend older than the sandbox). */
  | 'network_mismatch'
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

/**
 * `refundDelta` was given a `payment.refunded` event whose `refund.status` this SDK version does
 * not know, so it cannot tell which way the figure moved. Upgrade @fianto/sdk. Thrown from a
 * webhook callback, it answers 500, so fianto retries the delivery (and the event can be replayed
 * from the dashboard once you have upgraded) instead of the total being counted wrong.
 */
export class RefundStatusError extends FiantoError {
  override name = 'RefundStatusError';
  readonly code = 'unknown_refund_status';
  constructor(readonly refundStatus: string) {
    super(`Unknown payment.refunded refund status ${JSON.stringify(refundStatus)}: upgrade @fianto/sdk to a version that knows it.`);
  }
}
