// @vitest-environment jsdom
import { applyOverflowFallback, buttonMarkup, resolveButtonOptions } from './index.js';

function button(scrollWidth: number, clientWidth: number) {
  const el = document.createElement('button');
  el.innerHTML = buttonMarkup(resolveButtonOptions({}));
  const content = el.querySelector('.fianto-content')!;
  Object.defineProperty(content, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(content, 'clientWidth', { configurable: true, value: clientWidth });
  return el;
}

it('adds fianto-plain when the content overflows and removes it when it fits', () => {
  const el = button(200, 100);
  applyOverflowFallback(el);
  expect(el.classList.contains('fianto-plain')).toBe(true);
  const content = el.querySelector('.fianto-content')!;
  Object.defineProperty(content, 'scrollWidth', { configurable: true, value: 100 });
  applyOverflowFallback(el);
  expect(el.classList.contains('fianto-plain')).toBe(false);
});

it('does nothing without content', () => {
  expect(() => applyOverflowFallback(document.createElement('button'))).not.toThrow();
});
