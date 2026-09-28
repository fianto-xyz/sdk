// Internal: shared by `<fianto-button>` and `@fianto/react`'s `<FiantoButton>` (published as
// `@fianto/js/button-core` only so React can import it). Not a public API: it may change in any
// release without notice.
export type { ButtonLabel, ButtonLocale, ButtonOptions, ButtonShape, ButtonSize, ButtonTheme, ResolvedButton } from './options.js';
export { resolveButtonOptions } from './options.js';
export { buttonText, errorTextKey, STATUS_TEXT } from './labels.js';
export type { StatusTextKey } from './labels.js';
export { buttonClassName, buttonMarkup } from './markup.js';
export { BUTTON_CSS } from './styles.js';
export { applyOverflowFallback, observeOverflow } from './overflow.js';
