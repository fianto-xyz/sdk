import { FiantoError } from '@fianto/sdk';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

export const DEFAULT_LIMIT_BYTES = 1024 * 1024;

export class PayloadTooLargeError extends FiantoError {
  override name = 'PayloadTooLargeError';
}

/**
 * The body was already read and transformed by an upstream middleware (express.json(),
 * express.urlencoded(), a string body parser, ...). We can no longer see the exact bytes
 * the server received, which webhook signature verification and checkout's session read
 * both require. Thrown for both routes: checkout's createSession also reads the Request
 * body, so a silently-replaced body would be just as wrong there.
 */
export class BodyAlreadyParsedError extends FiantoError {
  override name = 'BodyAlreadyParsedError';
  constructor() {
    super(
      'The request body was already parsed by another middleware. Mount the fianto handler ' +
        'before express.json() / express.urlencoded(), or give its route express.raw({ type: "*/*" }).',
    );
  }
}

async function readStream(req: ExpressRequest, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.length;
    if (size > limit) throw new PayloadTooLargeError(`Request body is larger than ${limit} bytes.`);
    chunks.push(bytes);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * The exact bytes of the request body.
 *
 * `req.body === undefined` (Express 5's default with no body-parsing middleware mounted) means
 * nothing has touched the stream yet, so we read it ourselves. `req.body instanceof Uint8Array`
 * (a Buffer, set by express.raw()) means a parser ran but handed us the untouched bytes, so we
 * use it. Any other value — a string, a parsed object, including Express 4's `{}` left by
 * express.json()/urlencoded() when no body was sent — means a parser already consumed and
 * transformed the stream: we can no longer recover the original bytes, so we refuse loudly
 * instead of verifying (or forwarding) something that is not what the server received.
 */
async function rawBody(req: ExpressRequest, limit: number): Promise<Uint8Array | undefined> {
  const body: unknown = req.body;
  if (body === undefined) {
    if (req.method === 'GET' || req.method === 'HEAD') return undefined;
    return readStream(req, limit);
  }
  if (body instanceof Uint8Array) return body;
  throw new BodyAlreadyParsedError();
}

export async function toFetchRequest(req: ExpressRequest, limitBytes: number = DEFAULT_LIMIT_BYTES): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const body = await rawBody(req, limitBytes);
  return new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, {
    method: req.method,
    headers,
    body: body === undefined ? undefined : Buffer.from(body),
  });
}

export async function sendFetchResponse(res: ExpressResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'set-cookie') res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
