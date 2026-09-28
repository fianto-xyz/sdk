import { defineFiantoButton, FiantoButtonElement } from './element.js';

export { defineFiantoButton, FiantoButtonElement };

// Side-effect registration: importing `@fianto/js/button` registers `<fianto-button>`
// immediately. `defineFiantoButton` itself no-ops when `customElements` is undefined, so
// importing this module during SSR is harmless.
defineFiantoButton();
