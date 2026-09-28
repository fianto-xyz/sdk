import { applyOverflowFallback, BUTTON_CSS, buttonClassName, buttonMarkup, buttonText, errorTextKey, observeOverflow, resolveButtonOptions, STATUS_TEXT } from '../button-core/index.js';
import type { ButtonOptions, ResolvedButton, StatusTextKey } from '../button-core/index.js';
import { FiantoCheckoutError } from '../checkout/errors.js';
import { fetchCheckoutSession } from '../checkout/fetch-session.js';
import { focusCheckout, openCheckout } from '../checkout/open.js';
import type { CheckoutSessionSource } from '../checkout/session.js';

const OBSERVED_ATTRIBUTES = [
  'theme',
  'label',
  'shape',
  'size',
  'locale',
  'session-endpoint',
  'fallback',
  'disabled',
] as const;

const ERROR_DISPLAY_MS = 6000;

// `HTMLElement` doesn't exist outside a DOM (SSR, a plain Node `require`/`import`): referencing it
// in an `extends` clause throws at module-evaluation time, before `defineFiantoButton`'s own
// `typeof customElements === 'undefined'` guard ever runs. Extend a no-op stand-in there instead,
// so importing this module never throws — only *instantiating* the class (which nothing does
// outside a real DOM: `defineFiantoButton` never constructs it, `customElements.define` doesn't
// either) would need a real `HTMLElement`.
const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

/**
 * `<fianto-button>`: a branded "Pay with fianto" button as a custom element. Renders the
 * button-core markup/styles into an open shadow root, wires the click to `openCheckout`, and
 * emits `fianto:result` / `fianto:error` (bubbling, composed) instead of returning a promise, so
 * plain HTML pages with no build step can use it.
 */
export class FiantoButtonElement extends HTMLElementBase {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  #session: CheckoutSessionSource | undefined;
  #loading = false;
  #stopObserving: (() => void) | undefined;
  #statusTimer: ReturnType<typeof setTimeout> | undefined;
  #resolved: ResolvedButton = resolveButtonOptions({});
  #held = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // A `session` set on the element before `<fianto-button>` was defined is an own data property
    // shadowing the accessor: move it onto the private field (the standard upgrade pattern).
    // Not Object.hasOwn: that is ES2022, and the CDN bundle targets es2020 with no polyfills.
    if (Object.prototype.hasOwnProperty.call(this, 'session')) {
      const value = (this as { session?: CheckoutSessionSource }).session;
      delete (this as { session?: CheckoutSessionSource }).session;
      this.session = value;
    }
  }

  get session(): CheckoutSessionSource | undefined {
    return this.#session;
  }

  set session(value: CheckoutSessionSource | undefined) {
    this.#session = value;
  }

  connectedCallback(): void {
    this.#render();
    // Not the host: it is display: inline, and ResizeObserver never fires for an inline box.
    this.#stopObserving?.();
    const container = this.parentElement ?? (this.getRootNode() as { host?: Element }).host ?? null;
    this.#stopObserving = observeOverflow(this.shadowRoot!.querySelector('button')!, container);
  }

  disconnectedCallback(): void {
    this.#stopObserving?.();
    this.#stopObserving = undefined;
    if (this.#statusTimer !== undefined) clearTimeout(this.#statusTimer);
    this.#statusTimer = undefined;
    this.#held = false;
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.#render();
  }

  #options(): ButtonOptions {
    return {
      theme: this.getAttribute('theme') ?? undefined,
      label: this.getAttribute('label') ?? undefined,
      shape: this.getAttribute('shape') ?? undefined,
      size: this.getAttribute('size') ?? undefined,
      locale: this.getAttribute('locale') ?? undefined,
      loading: this.#loading,
      disabled: this.hasAttribute('disabled'),
    } as ButtonOptions;
  }

  #render(): void {
    const navigatorLanguage = typeof navigator !== 'undefined' ? navigator.language : undefined;
    this.#resolved = resolveButtonOptions(this.#options(), navigatorLanguage);
    const root = this.shadowRoot!;
    let style = root.querySelector('style');
    if (!style) {
      style = document.createElement('style');
      root.append(style);
    }
    style.textContent = BUTTON_CSS;

    let button = root.querySelector('button');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => this.#onClick());
      root.append(button);
    }
    button.className = buttonClassName(this.#resolved);
    button.innerHTML = buttonMarkup(this.#resolved);
    button.setAttribute('aria-label', buttonText(this.#resolved.label, this.#resolved.locale).ariaLabel);
    this.#applyBusy(button, this.#resolved.loading);

    let status = root.querySelector('.fianto-status');
    if (!status) {
      status = document.createElement('p');
      status.className = 'fianto-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      root.append(status);
    }

    this.#applyOverflowFallback();
  }

  #applyOverflowFallback(): void {
    const button = this.shadowRoot?.querySelector('button');
    if (button) applyOverflowFallback(button);
  }

  // Loading uses aria-disabled (plus #onClick's guard), not native `disabled`, so the button keeps
  // keyboard focus; native `disabled` is only for the explicit `disabled` attribute.
  #applyBusy(button: HTMLButtonElement, loading: boolean): void {
    button.setAttribute('aria-busy', String(loading));
    if (loading || this.#held) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    button.disabled = this.#resolved.disabled;
  }

  // `hold`: the checkout window was lost (result unknown). Keep the text until the next click and
  // hold the button for ERROR_DISPLAY_MS, so the payer reads it rather than starting a second
  // checkout straight away.
  #setStatus(key: StatusTextKey | null, hold = false): void {
    const status = this.shadowRoot?.querySelector('.fianto-status');
    if (status) status.textContent = key ? STATUS_TEXT[this.#resolved.locale][key] : '';
    if (this.#statusTimer !== undefined) clearTimeout(this.#statusTimer);
    this.#statusTimer = undefined;
    this.#held = hold;
    if (key) {
      this.#statusTimer = setTimeout(() => {
        this.#statusTimer = undefined;
        if (this.#held) {
          this.#held = false;
          this.#setLoading(this.#loading);
        } else {
          const el = this.shadowRoot?.querySelector('.fianto-status');
          if (el) el.textContent = '';
        }
      }, ERROR_DISPLAY_MS);
    }
    this.#setLoading(this.#loading);
  }

  #setLoading(loading: boolean): void {
    this.#loading = loading;
    const button = this.shadowRoot?.querySelector('button');
    if (!button) return;
    this.#applyBusy(button, loading);
  }

  #onClick(): void {
    if (this.#resolved.disabled) return;
    // Busy: the popup may have gone behind the page. Bring it back rather than open another.
    if (this.#loading) {
      focusCheckout();
      return;
    }
    if (this.#held) return;

    const endpoint = this.getAttribute('session-endpoint');
    const source: CheckoutSessionSource | undefined =
      this.#session ?? (endpoint ? () => fetchCheckoutSession(endpoint, { body: { ...this.dataset } }) : undefined);

    if (!source) {
      const message = 'No session source: set the session property or the session-endpoint attribute.';
      this.dispatchEvent(
        new CustomEvent('fianto:error', {
          detail: { code: 'no_session_source', message },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    this.#setStatus(null);
    this.#setLoading(true);
    const fallbackAttr = this.getAttribute('fallback');
    const fallback = fallbackAttr === 'none' ? 'none' : fallbackAttr === 'redirect' ? 'redirect' : undefined;

    openCheckout({ session: source, fallback }).then(
      (result) => {
        this.#setLoading(false);
        if (result.status === 'closed' && result.reason === 'unreachable') this.#setStatus('lost', true);
        this.dispatchEvent(
          new CustomEvent('fianto:result', {
            detail: { ...result },
            bubbles: true,
            composed: true,
          }),
        );
      },
      (error: unknown) => {
        this.#setLoading(false);
        const code = error instanceof FiantoCheckoutError ? error.code : 'unknown';
        const message = error instanceof Error ? error.message : 'Checkout could not be started.';
        // Payer-facing copy comes from button-core by code, never `message`: that is your route's
        // text for you (it can name params), and it stays in the event for you to log.
        this.#setStatus(errorTextKey(code));
        this.dispatchEvent(
          new CustomEvent('fianto:error', {
            detail: { code, message },
            bubbles: true,
            composed: true,
          }),
        );
      },
    );
  }
}

// The standard pattern for a custom element's .d.ts: lets `document.querySelector('fianto-button')`
// (and `createElement`, `getElementsByTagName`, …) resolve to `FiantoButtonElement` — with its
// `session` property, etc. — instead of the generic `Element`/`HTMLElement`. Only covers the
// default tag name `defineFiantoButton` registers below; a caller that renames it via
// `defineFiantoButton('my-tag')` gets no type benefit from this augmentation.
declare global {
  interface HTMLElementTagNameMap {
    'fianto-button': FiantoButtonElement;
  }
}

export function defineFiantoButton(tagName = 'fianto-button'): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(tagName)) {
    customElements.define(tagName, FiantoButtonElement);
  }
}
