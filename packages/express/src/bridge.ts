import { FiantoError } from '@fianto/sdk';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

export const DEFAULT_LIMIT_BYTES = 1024 * 1024;

export class PayloadTooLargeError extends FiantoError {
  override name = 'PayloadTooLargeError';
}

/**
 * The body stream was already read by an upstream middleware (express.json(), express.text(),
 * a logger listening for 'data', ...), and what it left in `req.body` is not the raw bytes. We
 * can no longer see the exact bytes the server received, which webhook signature verification
 * and checkout's session read both require. Thrown for both routes: checkout's createSession
 * also reads the Request body, so a silently-replaced body would be just as wrong there.
 */
export class BodyAlreadyParsedError extends FiantoError {
  override name = 'BodyAlreadyParsedError';
  constructor() {
    super(
      'The request body was already read by another middleware (express.json(), express.text(), ...), so the ' +
        'exact bytes fianto signed are gone. Register the fianto route before express.json() and other body ' +
        'parsers (route order matters), or give that route its own raw parser: ' +
        'app.post(path, express.raw({ type: "*/*" }), handler).',
    );
  }
}

function tooLarge(limit: number): PayloadTooLargeError {
  return new PayloadTooLargeError(`Request body is larger than ${limit} bytes.`);
}

async function readStream(req: ExpressRequest, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && /^\d+$/.test(declared.trim()) && Number(declared.trim()) > limit) throw tooLarge(limit);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.length;
    if (size > limit) throw tooLarge(limit);
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
 * True once anything has read the request stream. body-parser 1.x (Express 4) flags the
 * request it reads with `_body`; any reader leaves `readableDidRead`/`readableEnded` set.
 */
function streamConsumed(req: ExpressRequest): boolean {
  return (req as { _body?: unknown })._body === true || req.readableDidRead === true || req.readableEnded === true;
}

/**
 * The exact bytes of the request body.
 *
 * `req.body instanceof Uint8Array` (a Buffer, set by express.raw()) means a parser ran but handed
 * us the untouched bytes, so we use it. Otherwise, if nothing has read the stream yet we read it
 * ourselves — whatever `req.body` holds: Express 5 leaves it `undefined`, but Express 4's
 * body-parser sets `{}` even when it skips a request (a global express.urlencoded() or
 * express.text() in front of a JSON webhook). Once the stream has been read and transformed we can
 * no longer recover the original bytes, so we refuse loudly instead of verifying (or forwarding)
 * something that is not what the server received.
 */
async function rawBody(req: ExpressRequest, limit: number): Promise<Uint8Array | undefined> {
  const body: unknown = req.body;
  if (body instanceof Uint8Array) return body;
  if (streamConsumed(req)) throw new BodyAlreadyParsedError();
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  return readStream(req, limit);
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
    // No copy: a Buffer from express.raw() or our own read buffer, handed over as-is.
    body: body as Uint8Array<ArrayBuffer> | undefined,
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
