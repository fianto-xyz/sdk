/**
 * Overflow fallback shared by `<fianto-button>` and React's `<FiantoButton>`: when the localised
 * label doesn't fit, the button behaves like `label="plain"` (logo only) via `fianto-plain`.
 *
 * The label never wraps (`white-space: nowrap`), the button is capped at its container's width
 * (`max-width: 100%`) and `.fianto-content` may shrink below its content (`min-width: 0`), so the
 * content's `scrollWidth` is the label's natural width and its `clientWidth` the room the button
 * gives it. Measured with `fianto-plain` removed: with the prefix hidden the content would always
 * fit, and the fallback would flip off and on at every resize.
 */
export function applyOverflowFallback(button: HTMLElement): void {
  const content = button.querySelector<HTMLElement>('.fianto-content');
  if (!content) return;
  button.classList.remove('fianto-plain');
  button.classList.toggle('fianto-plain', content.scrollWidth > content.clientWidth);
}

/**
 * Re-runs the fallback whenever the button or its container changes size. The container too: a
 * logo-only static button stays the same width when its container widens, so only the container
 * reports the room the label could now have. Returns the disconnect function.
 */
export function observeOverflow(button: HTMLElement, container: Element | null): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(() => applyOverflowFallback(button));
  observer.observe(button);
  if (container) observer.observe(container);
  return () => observer.disconnect();
}
