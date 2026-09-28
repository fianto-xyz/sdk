import { readBoundedBody } from './body.js';

function streamOf(chunks: unknown[]) {
  const state = { canceled: false };
  const stream = new ReadableStream({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) controller.close();
      // Pushed through unchanged (even when not a Uint8Array) to simulate a stream that
      // doesn't honour the `ReadableStream<Uint8Array>` type at runtime.
      else (controller as ReadableStreamDefaultController<unknown>).enqueue(next);
    },
    cancel() { state.canceled = true; },
  });
  return { stream: stream as unknown as ReadableStream<Uint8Array>, state };
}

function requestWith(stream: ReadableStream<Uint8Array>) {
  return new Request('https://shop.test/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
}

it('reads a well-formed Uint8Array body into one buffer with the prefix', async () => {
  const { stream } = streamOf([new Uint8Array([4, 5]), new Uint8Array([6])]);
  const content = await readBoundedBody(requestWith(stream), new Uint8Array([1, 2, 3]), 100);
  expect(Array.from(content)).toEqual([1, 2, 3, 4, 5, 6]);
});

it('rejects a chunk that is not a Uint8Array instead of silently bypassing the size limit', async () => {
  // A string chunk has no numeric byteLength: `size += value.byteLength` would make `size`
  // NaN, and `NaN > limit` is always false, so an unbounded body would sail through unrejected.
  const { stream, state } = streamOf(['not-bytes']);
  await expect(readBoundedBody(requestWith(stream), new Uint8Array(0), 10)).rejects.toMatchObject({
    name: 'WebhookVerificationError',
    reason: 'invalid_payload',
  });
  expect(state.canceled).toBe(true);
});

it('rejects a stream mixing valid and invalid chunks as soon as the invalid one arrives', async () => {
  const { stream } = streamOf([new Uint8Array([1]), { not: 'bytes' }]);
  await expect(readBoundedBody(requestWith(stream), new Uint8Array(0), 100)).rejects.toMatchObject({
    reason: 'invalid_payload',
  });
});
