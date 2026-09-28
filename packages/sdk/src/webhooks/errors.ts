import { FiantoError } from '../core/errors.js';

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
