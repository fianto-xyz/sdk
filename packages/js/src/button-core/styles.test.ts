// @vitest-environment jsdom
import { BUTTON_CSS } from './index.js';

const HEIGHT = 'clamp(40px, var(--fianto-button-height, 44px), 55px)';

it('lets a host --fianto-button-radius win over the shape radius', () => {
  expect(BUTTON_CSS).toContain(`border-radius: min(var(--fianto-button-radius, var(--_fianto-shape-radius)), calc(${HEIGHT} / 2))`);
  expect(BUTTON_CSS).toContain('--_fianto-shape-radius: 4px');
  expect(BUTTON_CSS).toContain('--_fianto-shape-radius: 999px');
  const style = document.createElement('style');
  style.textContent = BUTTON_CSS;
  document.head.append(style);
  const declared: string[] = [];
  for (const rule of Array.from(style.sheet!.cssRules)) {
    if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes('.fianto-button')) continue;
    for (let i = 0; i < rule.style.length; i += 1) declared.push(rule.style[i]!);
  }
  expect(declared).toContain('--_fianto-shape-radius');
  expect(declared).not.toContain('--fianto-button-radius');
});

it('derives padding from the clamped height', () => {
  expect(BUTTON_CSS).toContain(`padding: 0 calc(${HEIGHT} / 10 * 2)`);
  expect(BUTTON_CSS).not.toMatch(/padding:[^;]*calc\(var\(--fianto-button-height/);
});
