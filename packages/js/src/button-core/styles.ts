// Scoped entirely to `.fianto-button` (plus its descendants) so this string works dropped into a
// shadow root's <style> (Task 4's custom element) or a light-DOM <style> (Task 5's React
// component) with no `:host` or other scoping trick. No margin: the host owns layout: the
// package README documents the height/10 clear-space callers should leave around the button.
export const BUTTON_CSS = `
.fianto-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5em;
  box-sizing: border-box;
  height: clamp(40px, var(--fianto-button-height, 44px), 55px);
  width: var(--fianto-button-width, auto);
  max-width: 100%;
  min-width: 160px;
  padding: 0 calc(clamp(40px, var(--fianto-button-height, 44px), 55px) / 10 * 2);
  border: none;
  --_fianto-shape-radius: 8px;
  border-radius: min(var(--fianto-button-radius, var(--_fianto-shape-radius)), calc(clamp(40px, var(--fianto-button-height, 44px), 55px) / 2));
  font: 600 15px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
  user-select: none;
  position: relative;
}

.fianto-button.fianto-size-fill {
  width: 100%;
}

/* Shapes set a private radius; the public --fianto-button-radius (set on the host or any ancestor)
   is never declared here, so it inherits down and overrides all three. */
.fianto-button.fianto-shape-rect {
  --_fianto-shape-radius: 4px;
}
.fianto-button.fianto-shape-rounded {
  --_fianto-shape-radius: 8px;
}
.fianto-button.fianto-shape-pill {
  --_fianto-shape-radius: 999px;
}

.fianto-button.fianto-theme-brand,
.fianto-button.fianto-theme-auto {
  background: #0002F8;
  color: #FFFFFF;
  --fianto-mark: #FFFFFF;
  --fianto-fg: #FFFFFF;
}
.fianto-button.fianto-theme-dark {
  background: #0B0B10;
  color: #FFFFFF;
  --fianto-mark: #FFFFFF;
  --fianto-fg: #FFFFFF;
  /* An edge that stays visible on a dark page (3.2:1 on #000). */
  border: 1px solid #5C5C70;
}
.fianto-button.fianto-theme-light {
  background: #FFFFFF;
  color: #0B0B10;
  --fianto-mark: #0002F8;
  --fianto-fg: #0B0B10;
  border: 1px solid #D9D9E3;
}
.fianto-button.fianto-theme-outline {
  background: transparent;
  color: currentColor;
  --fianto-mark: currentColor;
  --fianto-fg: currentColor;
  border: 1px solid currentColor;
}

@media (prefers-color-scheme: dark) {
  .fianto-button.fianto-theme-auto {
    background: #0B0B10;
    color: #FFFFFF;
    --fianto-mark: #FFFFFF;
    --fianto-fg: #FFFFFF;
    border: 1px solid #5C5C70;
  }
}

.fianto-content {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  /* Shrinks to the room the button has, so scrollWidth > clientWidth when the label doesn't fit. */
  min-width: 0;
}

.fianto-prefix {
  white-space: nowrap;
}

.fianto-logo {
  height: 1.25em;
  width: auto;
  flex-shrink: 0;
  display: block;
}

.fianto-mark {
  fill: var(--fianto-mark);
}
.fianto-wordmark {
  fill: var(--fianto-fg);
}

.fianto-button:focus-visible {
  outline: 2px solid var(--fianto-button-focus-ring, #0002F8);
  outline-offset: 2px;
  /* Two-tone ring: white fills the offset gap, so on any page background either the white
     (dark pages) or the outline (light pages) reaches 3:1. */
  box-shadow: 0 0 0 2px #FFFFFF;
}

/* loading: show the spinner and hide the label, keeping the accessible name (the button's aria-label, set by the caller — unaffected by hiding its children). */
.fianto-button[aria-busy='true'] .fianto-content {
  visibility: hidden;
}
.fianto-button[aria-busy='true'] .fianto-spinner {
  visibility: visible;
}

.fianto-spinner {
  visibility: hidden;
  position: absolute;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: fianto-spin 0.75s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .fianto-spinner {
    animation: none;
  }
}

@keyframes fianto-spin {
  to {
    transform: rotate(360deg);
  }
}

.fianto-button[aria-disabled='true'] {
  cursor: progress;
}

.fianto-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Overflow fallback (Tasks 4/5 toggle this when the localised label doesn't fit): behave like label="plain". */
.fianto-plain .fianto-prefix {
  display: none;
}

.fianto-status {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.3;
}
/* Empty: visually hidden but still in the accessibility tree, so the live region is already
   registered when a message arrives and screen readers announce it. */
.fianto-status:empty {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`;
