import type { Page } from '../types.js';

/**
 * `await` it for one page, or `for await` it for every item. Pages are fetched lazily. Iteration
 * ends on `next_cursor: null` or on an empty page (the API returns a cursor after a full last page).
 */
export class PagePromise<T, C extends string | number> implements PromiseLike<Page<T, C>>, AsyncIterable<T> {
  private first: Promise<Page<T, C>> | undefined;

  constructor(
    private readonly fetchPage: (cursor: string | undefined) => Promise<Page<T, C>>,
    private readonly startCursor?: string,
  ) {}

  private firstPage(): Promise<Page<T, C>> {
    this.first ??= this.fetchPage(this.startCursor);
    return this.first;
  }

  then<R1 = Page<T, C>, R2 = never>(
    onfulfilled?: ((value: Page<T, C>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.firstPage().then(onfulfilled, onrejected);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page = await this.firstPage();
    for (;;) {
      yield* page.items;
      if (page.next_cursor === null || page.items.length === 0) return;
      page = await this.fetchPage(String(page.next_cursor));
      if (page.items.length === 0) return;
    }
  }
}
