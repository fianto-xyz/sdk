import { BUTTON_CSS, buttonClassName, buttonMarkup, buttonText, ERROR_TEXT, resolveButtonOptions } from '../button-core/index.js';
import type { ButtonOptions, ResolvedButton } from '../button-core/index.js';
import { openCheckout } from '../checkout/open.js';
import { FiantoCheckoutError } from '../checkout/errors.js';
import type { CheckoutSession, CheckoutSessionSource } from '../checkout/session.js';

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

async function fetchSession(endpoint: string, dataset: DOMStringMap): Promise<CheckoutSession> {
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...dataset }),
  });
  if (!response.ok) {
    let code = 'unknown';
    let message = `Checkout session request failed with status ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
      if (typeof body?.error?.code === 'string') code = body.error.code;
      if (typeof body?.error?.message === 'string') message = body.error.message;
    } catch {
      // No JSON body: fall back to the generic message above.
    }
    throw new FiantoCheckoutError(code, message);
  }
  return (await response.json()) as CheckoutSession;
}

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
  #resizeObserver: ResizeObserver | undefined;
  #statusTimer: ReturnType<typeof setTimeout> | undefined;
  #resolved: ResolvedButton = resolveButtonOptions({});

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get session(): CheckoutSessionSource | undefined {
    return this.#session;
  }

  set session(value: CheckoutSessionSource | undefined) {
    this.#session = value;
  }

  connectedCallback(): void {
    this.#render();
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => this.#applyOverflowFallback());
      this.#resizeObserver.observe(this);
    }
  }

  disconnectedCallback(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    if (this.#statusTimer !== undefined) clearTimeout(this.#statusTimer);
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
    button.setAttribute('aria-busy', String(this.#resolved.loading));
    button.disabled = this.#resolved.disabled || this.#resolved.loading;

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
    const content = button?.querySelector<HTMLElement>('.fianto-content');
    if (!button || !content) return;
    if (content.scrollWidth > content.clientWidth) {
      button.classList.add('fianto-plain');
    } else {
      button.classList.remove('fianto-plain');
    }
  }

  #setStatusText(text: string): void {
    const status = this.shadowRoot?.querySelector('.fianto-status');
    if (status) status.textContent = text;
    if (this.#statusTimer !== undefined) clearTimeout(this.#statusTimer);
    if (text) {
      this.#statusTimer = setTimeout(() => {
        const el = this.shadowRoot?.querySelector('.fianto-status');
        if (el) el.textContent = '';
      }, ERROR_DISPLAY_MS);
    }
  }

  #setLoading(loading: boolean): void {
    this.#loading = loading;
    const button = this.shadowRoot?.querySelector('button');
    if (!button) return;
    button.setAttribute('aria-busy', String(loading));
    button.disabled = loading || this.#resolved.disabled;
  }

  #onClick(): void {
    if (this.#resolved.disabled || this.#loading) return;

    const endpoint = this.getAttribute('session-endpoint');
    const source: CheckoutSessionSource | undefined =
      this.#session ?? (endpoint ? () => fetchSession(endpoint, this.dataset) : undefined);

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

    this.#setLoading(true);
    const fallbackAttr = this.getAttribute('fallback');
    const fallback = fallbackAttr === 'none' ? 'none' : fallbackAttr === 'redirect' ? 'redirect' : undefined;

    openCheckout({ session: source, fallback }).then(
      (result) => {
        this.#setLoading(false);
        this.dispatchEvent(
          new CustomEvent('fianto:result', {
            detail: { status: result.status, session_id: result.session_id },
            bubbles: true,
            composed: true,
          }),
        );
      },
      (error: unknown) => {
        this.#setLoading(false);
        const code = error instanceof FiantoCheckoutError ? error.code : 'unknown';
        const message = error instanceof Error ? error.message : 'Checkout could not be started.';
        this.#setStatusText(ERROR_TEXT[this.#resolved.locale][code === 'payment_in_progress' ? 'payment_in_progress' : 'generic']);
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

export function defineFiantoButton(tagName = 'fianto-button'): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(tagName)) {
    customElements.define(tagName, FiantoButtonElement);
  }
}
