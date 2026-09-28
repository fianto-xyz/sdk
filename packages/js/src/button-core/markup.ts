import { MARK_PATHS, MARK_ROTATED_INDEX, MARK_TRANSFORM, MARK_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from './brand.js';
import { buttonText } from './labels.js';
import type { ResolvedButton } from './options.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function boxSize(viewBox: string): { width: number; height: number } {
  const parts = viewBox.split(' ').map(Number);
  return { width: parts[2] ?? 0, height: parts[3] ?? 0 };
}

const mark = boxSize(MARK_VIEWBOX);
const word = boxSize(WORDMARK_VIEWBOX);

// The mark and the wordmark are unrelated coordinate systems: a viewBox-scaled icon and an
// outlined font at its own design units. Scale them into one canvas using the icon-size :
// text-size ratio from merchant-frontend/src/components/ui/logo.tsx (a 24px mark next to 22px,
// 600-weight text) and the wordmark's units-per-em (1000, from its WORDMARK_VIEWBOX height being
// generated at that scale), applied on top of the mark's own viewBox size — so the combined SVG
// stays a fixed, resolution-independent ratio with no per-render layout work.
const ICON_PX = 24;
const TEXT_PX = 22;
const GAP_PX = 10;
const FONT_UNITS_PER_EM = 1000;

const wordmarkScale = (TEXT_PX / ICON_PX) * (mark.height / FONT_UNITS_PER_EM);
const gap = (GAP_PX / ICON_PX) * mark.height;
const wordmarkWidth = word.width * wordmarkScale;
const wordmarkHeight = word.height * wordmarkScale;

const canvasWidth = mark.width + gap + wordmarkWidth;
const canvasHeight = Math.max(mark.height, wordmarkHeight);
const markY = (canvasHeight - mark.height) / 2;
const wordmarkY = (canvasHeight - wordmarkHeight) / 2;

function logoSvg(): string {
  const markPaths = MARK_PATHS.map((d, i) =>
    i === MARK_ROTATED_INDEX ? `<path d="${d}" transform="rotate(180 613 604.5)" />` : `<path d="${d}" />`,
  ).join('');
  return (
    `<svg class="fianto-logo" viewBox="0 0 ${canvasWidth} ${canvasHeight}" aria-hidden="true" focusable="false">` +
    `<svg x="0" y="${markY}" width="${mark.width}" height="${mark.height}" viewBox="${MARK_VIEWBOX}">` +
    `<g class="fianto-mark" transform="${MARK_TRANSFORM}">${markPaths}</g>` +
    `</svg>` +
    `<svg x="${mark.width + gap}" y="${wordmarkY}" width="${wordmarkWidth}" height="${wordmarkHeight}" viewBox="${WORDMARK_VIEWBOX}">` +
    `<path class="fianto-wordmark" d="${WORDMARK_PATH}" />` +
    `</svg>` +
    `</svg>`
  );
}

/**
 * Inner HTML of the `<button>` (Task 4's custom element, Task 5's React component render exactly
 * this). The `<button>` itself, and its `aria-label`/`aria-busy`/`disabled` attributes, belong to
 * those tasks — this only builds the label and the locked logo mark+wordmark, one SVG so their
 * size and relative position can never drift apart.
 */
export function buttonMarkup(resolved: ResolvedButton): string {
  const { prefix } = buttonText(resolved.label, resolved.locale);
  return (
    `<span class="fianto-content">` +
    `<span class="fianto-prefix">${escapeHtml(prefix)}</span>` +
    logoSvg() +
    `</span>` +
    `<span class="fianto-spinner" aria-hidden="true"></span>`
  );
}

export function buttonClassName(resolved: ResolvedButton): string {
  return [
    'fianto-button',
    `fianto-theme-${resolved.theme}`,
    `fianto-shape-${resolved.shape}`,
    `fianto-size-${resolved.size}`,
    `fianto-label-${resolved.label}`,
  ].join(' ');
}
