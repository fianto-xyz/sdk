import { openCheckout } from '../checkout/open.js';
import { redirectToCheckout } from '../checkout/redirect.js';
import './index.js';

// Entry for the IIFE CDN bundle (dist/fianto-button.global.js): registers <fianto-button> as a
// side effect of `./index.js` and exposes the imperative API for plain <script> pages with no
// bundler.
(globalThis as typeof globalThis & { Fianto?: { openCheckout: typeof openCheckout; redirectToCheckout: typeof redirectToCheckout } }).Fianto = {
  openCheckout,
  redirectToCheckout,
};
