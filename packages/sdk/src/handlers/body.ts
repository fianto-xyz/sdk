import { FiantoError } from '../core/errors.js';
import { WebhookVerificationError } from '../webhooks/errors.js';

export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/** `maxBodyBytes` validated, or the 1 MiB default. Throws a configuration error. */
export function resolveMaxBodyBytes(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new FiantoError('maxBodyBytes must be a positive whole number of bytes.');
  return limit;
}

function tooLarge(limit: number): WebhookVerificationError {
  return new WebhookVerificationError('payload_too_large', `The webhook body is larger than ${limit} bytes.`);
}

/**
 * Reads the request body into one buffer that starts with `prefix` (what the signature covers
 * ahead of the body), so verification needs no further copy. Refuses a declared content-length
 * over `limit` without reading, and stops reading (canceling the stream) as soon as the bytes
 * received pass `limit`.
 */
export async function readBoundedBody(request: Request, prefix: Uint8Array, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared.trim()) > limit) throw tooLarge(limit);

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        reader.cancel().catch(() => undefined);
        throw tooLarge(limit);
      }
      chunks.push(value);
    }
  }
  const content = new Uint8Array(prefix.length + size);
  content.set(prefix);
  let offset = prefix.length;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return content;
}
