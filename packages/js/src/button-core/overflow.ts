/**
 * Overflow fallback shared by `<fianto-button>` and React's `<FiantoButton>`: when the localised
 * label doesn't fit, the button behaves like `label="plain"` (logo only) via `fianto-plain`.
 */
export function applyOverflowFallback(button: HTMLElement): void {
  const content = button.querySelector<HTMLElement>('.fianto-content');
  if (!content) return;
  button.classList.toggle('fianto-plain', content.scrollWidth > content.clientWidth);
}
