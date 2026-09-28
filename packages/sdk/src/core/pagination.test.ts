import { PagePromise } from './pagination.js';

function pager(pages: Record<string, { items: number[]; next_cursor: number | null }>) {
  const seen: Array<string | undefined> = [];
  const promise = new PagePromise<number, number>(async (cursor) => {
    seen.push(cursor);
    return pages[cursor ?? 'first']!;
  });
  return { promise, seen };
}

it('awaits to the first page only', async () => {
  const { promise, seen } = pager({ first: { items: [3, 2], next_cursor: 2 } });
  await expect(promise).resolves.toEqual({ items: [3, 2], next_cursor: 2 });
  expect(seen).toEqual([undefined]);
});

it('iterates every item across pages', async () => {
  const { promise, seen } = pager({
    first: { items: [5, 4], next_cursor: 4 },
    '4': { items: [3, 2], next_cursor: 2 },
    '2': { items: [1], next_cursor: null },
  });
  const all: number[] = [];
  for await (const item of promise) all.push(item);
  expect(all).toEqual([5, 4, 3, 2, 1]);
  expect(seen).toEqual([undefined, '4', '2']);
});

// Review Focus 5: a full last page yields a cursor, then an empty page.
it('stops on an empty page after a full one', async () => {
  const { promise, seen } = pager({ first: { items: [2, 1], next_cursor: 1 }, '1': { items: [], next_cursor: null } });
  const all: number[] = [];
  for await (const item of promise) all.push(item);
  expect(all).toEqual([2, 1]);
  expect(seen).toEqual([undefined, '1']);
});

it('stops on an empty page even if the server sends a cursor', async () => {
  const { promise } = pager({ first: { items: [], next_cursor: 9 } });
  const all: number[] = [];
  for await (const item of promise) all.push(item);
  expect(all).toEqual([]);
});

it('starts from a given cursor', async () => {
  const seen: Array<string | undefined> = [];
  const promise = new PagePromise<number, number>(async (cursor) => { seen.push(cursor); return { items: [], next_cursor: null }; }, '42');
  await promise;
  expect(seen).toEqual(['42']);
});
