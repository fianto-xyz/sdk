import { fetchCheckoutSession } from '../checkout/fetch-session.js';
import { focusCheckout, openCheckout } from '../checkout/open.js';
import { redirectToCheckout } from '../checkout/redirect.js';
import './index.js';

// Entry for the IIFE CDN bundle (dist/fianto-button.global.iife.js): registers <fianto-button>
// as a side effect of `./index.js` and exposes the imperative API for plain <script> pages with
// no bundler.
const api = { openCheckout, redirectToCheckout, fetchCheckoutSession, focusCheckout };
(globalThis as typeof globalThis & { Fianto?: typeof api }).Fianto = api;
