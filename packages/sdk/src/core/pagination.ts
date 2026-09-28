import type { Page } from '../types.js';

/**
 * Normalises a raw page's `next_cursor` to the opaque string every list `cursor` param accepts,
 * so `list({ cursor: page.next_cursor })` type-checks for every resource without the caller
 * converting — orders/payments/prices/products/subscriptions' numeric keyset cursor included
 * (F7/A7). The backend accepts a string cursor on every list operation's query (see
 * `spec/openapi.json`; an unparseable value just starts from the first page), so this loses
 * nothing on the wire.
 */
export function stringifyCursor<T>(raw: { items: T[]; next_cursor: number | null }): Page<T> {
  return { items: raw.items, next_cursor: raw.next_cursor === null ? null : String(raw.next_cursor) };
}

/**
 * `await` it for one page, or `for await` it for every item. Pages are fetched lazily. Iteration
 * ends on `next_cursor: null` or on an empty page (the API returns a cursor after a full last page).
 * Not generic over the cursor's wire type: every `list()` normalises it to `Page<T>`'s opaque
 * string (`stringifyCursor`) before it ever reaches here, so there is only one cursor shape to
 * advertise, not a numeric one some resources never actually produce (F7/A7 fix round 1).
 */
export class PagePromise<T> implements PromiseLike<Page<T>>, AsyncIterable<T> {
  private first: Promise<Page<T>> | undefined;

  constructor(
    private readonly fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
    private readonly startCursor?: string,
  ) {}

  private firstPage(): Promise<Page<T>> {
    this.first ??= this.fetchPage(this.startCursor);
    return this.first;
  }

  // Deliberately thenable: `await`ing a list() call is the documented way to get its first page,
  // alongside `for await` for every item.
  // oxlint-disable-next-line unicorn/no-thenable -- see comment above
  then<R1 = Page<T>, R2 = never>(
    onfulfilled?: ((value: Page<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.firstPage().then(onfulfilled, onrejected);
  }

  catch<R = never>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<Page<T> | R> {
    return this.firstPage().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<Page<T>> {
    return this.firstPage().finally(onfinally);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page = await this.firstPage();
    for (;;) {
      yield* page.items;
      if (page.next_cursor === null || page.items.length === 0) return;
      page = await this.fetchPage(page.next_cursor);
      if (page.items.length === 0) return;
    }
  }
}
