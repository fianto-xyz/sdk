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

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
function block(selector: string): string {
  const start = BUTTON_CSS.indexOf(`${selector} {`);
  return BUTTON_CSS.slice(start, BUTTON_CSS.indexOf('}', start));
}

const PAGES = ['#FFFFFF', '#F5F5F7', '#808080', '#121212', '#000000', '#0B0B10', '#0002F8'];

// D5: one tone of the two-tone ring reaches 3:1 on light, mid and dark page backgrounds.
it.each(PAGES)('keeps the focus ring at 3:1 or more on a %s page', (page) => {
  const focus = block('.fianto-button:focus-visible');
  const outline = /outline: 2px solid var\(--fianto-button-focus-ring, (#[0-9A-F]{6})\)/.exec(focus)![1]!;
  const inner = /box-shadow: 0 0 0 2px (#[0-9A-F]{6})/.exec(focus)![1]!;
  expect(focus).toContain('outline-offset: 2px'); // the inner tone fills exactly the offset gap
  expect(Math.max(contrast(outline, page), contrast(inner, page))).toBeGreaterThanOrEqual(3);
});

// D9: the dark button (and auto in dark mode) keeps a visible edge on a dark page.
it('gives the dark and auto-dark themes an edge of 3:1 on a black page', () => {
  const dark = /border: 1px solid (#[0-9A-F]{6})/.exec(block('.fianto-button.fianto-theme-dark'))![1]!;
  expect(contrast(dark, '#000000')).toBeGreaterThanOrEqual(3);
  const media = BUTTON_CSS.slice(BUTTON_CSS.indexOf('@media (prefers-color-scheme: dark)'));
  const autoDark = media.slice(0, media.indexOf('}'));
  expect(autoDark).toContain('.fianto-button.fianto-theme-auto');
  expect(autoDark).toContain(`border: 1px solid ${dark}`);
});

// D6: an empty live region stays in the accessibility tree (visually hidden, never display:none).
it('keeps the empty status region rendered, only visually hidden', () => {
  expect(BUTTON_CSS).not.toMatch(/\.fianto-status[^{]*\{[^}]*display:\s*none/);
  const style = document.createElement('style');
  style.textContent = BUTTON_CSS;
  document.head.append(style);
  const status = document.createElement('p');
  status.className = 'fianto-status';
  document.body.append(status);
  expect(getComputedStyle(status).display).not.toBe('none');
  expect(getComputedStyle(status).visibility).not.toBe('hidden');
  expect(getComputedStyle(status).clipPath).toBe('inset(50%)');
  status.textContent = 'x';
  expect(getComputedStyle(status).clipPath).not.toBe('inset(50%)');
  status.remove();
  style.remove();
});
