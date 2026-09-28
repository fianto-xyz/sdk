/**
 * Overflow fallback shared by `<fianto-button>` and React's `<FiantoButton>`: when the localised
 * label doesn't fit, the button behaves like `label="plain"` (logo only) via `fianto-plain`.
 *
 * The label never wraps (`white-space: nowrap`) and `.fianto-content` clips (`min-width: 0;
 * overflow: hidden`), so its `scrollWidth` is the label's natural width and `clientWidth` the room
 * the button gives it. Measured with `fianto-plain` removed: with the prefix hidden the content
 * would always fit, and the fallback would flip off and on at every resize.
 */
export function applyOverflowFallback(button: HTMLElement): void {
  const content = button.querySelector<HTMLElement>('.fianto-content');
  if (!content) return;
  button.classList.remove('fianto-plain');
  button.classList.toggle('fianto-plain', content.scrollWidth > content.clientWidth);
}
