// @vitest-environment jsdom
import { applyOverflowFallback, BUTTON_CSS, buttonMarkup, resolveButtonOptions } from './index.js';

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

// D2: the natural label width is what counts. With `fianto-plain` applied the prefix is hidden
// and the content fits, so measuring in that state would flip the fallback off (and back on at
// the next resize). Widths are stubbed per state, since jsdom has no layout.
it('measures the natural label width even while the fallback is applied', () => {
  const el = document.createElement('button');
  el.innerHTML = buttonMarkup(resolveButtonOptions({ locale: 'vi', label: 'subscribe' }));
  const content = el.querySelector('.fianto-content')!;
  Object.defineProperty(content, 'scrollWidth', { configurable: true, get: () => (el.classList.contains('fianto-plain') ? 65 : 210) });
  Object.defineProperty(content, 'clientWidth', { configurable: true, value: 142 });
  for (let resize = 0; resize < 3; resize += 1) {
    applyOverflowFallback(el);
    expect(el.classList.contains('fianto-plain')).toBe(true);
  }
});

it('lets the label neither wrap nor push the button past its container', () => {
  const style = document.createElement('style');
  style.textContent = BUTTON_CSS;
  document.head.append(style);
  const rule = (selector: string) =>
    Array.from(style.sheet!.cssRules).find((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === selector)!.style;
  expect(rule('.fianto-prefix').whiteSpace).toBe('nowrap');
  expect(rule('.fianto-content').minWidth).toBe('0px');
  expect(rule('.fianto-button').maxWidth).toBe('100%');
  style.remove();
});
