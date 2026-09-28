// @vitest-environment jsdom
import axe from 'axe-core';
import { defineFiantoButton, FiantoButtonElement } from './index.js';
import { MESSAGE_TYPE } from '../checkout/message.js';

function fakePopup() {
  return { closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {}, focus: vi.fn() };
}

defineFiantoButton();

function mount(attrs: Record<string, string> = {}) {
  const el = document.createElement('fianto-button') as FiantoButtonElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  const button = el.shadowRoot!.querySelector('button')!;
  return { el, button };
}

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('renders an accessible native button from attributes', async () => {
  const { button } = mount({ label: 'subscribe', locale: 'vi', theme: 'dark', shape: 'pill' });
  expect(button.getAttribute('aria-label')).toBe('Đăng ký với fianto');
  expect(button.className).toContain('fianto-theme-dark');
  expect(button.className).toContain('fianto-shape-pill');
  const results = await axe.run(button, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations).toEqual([]);
});

it('re-renders when an attribute changes and is idempotent to define', () => {
  const { el } = mount();
  el.setAttribute('theme', 'outline');
  expect(el.shadowRoot!.querySelector('button')!.className).toContain('fianto-theme-outline');
  expect(() => defineFiantoButton()).not.toThrow();
});

it('posts data-* to the session endpoint, opens checkout and emits fianto:result', async () => {
  const popup = { closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {} };
  vi.stubGlobal('open', vi.fn(() => popup));
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'fian_cs_1', url: 'https://pay.test/c/x' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const { el, button } = mount({ 'session-endpoint': '/api/checkout', 'data-plan': 'pro' });
  const result = new Promise<CustomEvent>((resolve) => el.addEventListener('fianto:result', (e) => resolve(e as CustomEvent)));
  button.click();
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(button.disabled).toBe(false); // keeps focus while loading
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith('/api/checkout', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"plan":"pro"}' }));
  window.dispatchEvent(new MessageEvent('message', { data: { type: MESSAGE_TYPE, session_id: 'fian_cs_1', status: 'succeeded' }, origin: 'https://pay.test', source: popup as unknown as MessageEventSource }));
  expect((await result).detail).toEqual({ status: 'succeeded', session_id: 'fian_cs_1' });
  expect(button.getAttribute('aria-busy')).toBe('false');
  expect(button.hasAttribute('aria-disabled')).toBe(false);
  expect(button.disabled).toBe(false);
});

it('shows the in-progress message on a 409 and emits fianto:error', async () => {
  vi.stubGlobal('open', vi.fn(() => ({ closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {} })));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'payment_in_progress', message: 'x' } }), { status: 409 })));
  const { el, button } = mount({ 'session-endpoint': '/api/checkout' });
  const error = new Promise<CustomEvent>((resolve) => el.addEventListener('fianto:error', (e) => resolve(e as CustomEvent)));
  button.click();
  expect((await error).detail.code).toBe('payment_in_progress');
  expect(el.shadowRoot!.querySelector('.fianto-status')!.textContent).toBe('A payment for this order is already in progress.');
});

it('ignores clicks while disabled', () => {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  const { button } = mount({ disabled: '', 'session-endpoint': '/x' });
  button.click();
  expect(open).not.toHaveBeenCalled();
});

it('uses the session property over session-endpoint', async () => {
  const popup = { closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {} };
  vi.stubGlobal('open', vi.fn(() => popup));
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const { el, button } = mount({ 'session-endpoint': '/api/checkout' });
  el.session = { id: 'fian_cs_9', url: 'https://pay.test/c/y' };
  button.click();
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith('https://pay.test/c/y'));
  expect(fetchMock).not.toHaveBeenCalled();
});

// D4: a busy click brings the popup back instead of doing nothing or opening a second one.
it('keeps focus while loading, and a second click focuses the popup instead of opening another', async () => {
  const popup = fakePopup();
  const open = vi.fn(() => popup);
  vi.stubGlobal('open', open);
  const { el, button } = mount();
  el.session = { id: 'fian_cs_1', url: 'https://pay.test/c/x' };
  button.focus();
  button.click();
  expect(el.shadowRoot!.activeElement).toBe(button);
  button.click();
  expect(open).toHaveBeenCalledTimes(1);
  expect(popup.focus).toHaveBeenCalledOnce();
});

// F13
it('picks up a session property set before the element was defined', async () => {
  const popup = fakePopup();
  vi.stubGlobal('open', vi.fn(() => popup));
  const el = document.createElement('fianto-button-late') as FiantoButtonElement;
  const session = { id: 'fian_cs_late', url: 'https://pay.test/c/late' };
  el.session = session;
  document.body.append(el);
  customElements.define('fianto-button-late', class extends FiantoButtonElement {});
  expect(el).toBeInstanceOf(FiantoButtonElement);
  expect(el.session).toBe(session);
  expect(Object.hasOwn(el, 'session')).toBe(false);
  el.shadowRoot!.querySelector('button')!.click();
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith(session.url));
});

// D1: a checkout window cut off by COOP reads as closed while the payer may still be paying.
it('on an unreachable popup shows the lost-window message and holds the button before re-enabling', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const popup = fakePopup();
  const open = vi.fn(() => popup);
  vi.stubGlobal('open', open);
  const { el, button } = mount({ locale: 'en' });
  el.session = { id: 'fian_cs_1', url: 'https://pay.test/c/x' };
  const result = new Promise<CustomEvent>((resolve) => el.addEventListener('fianto:result', (e) => resolve(e as CustomEvent)));
  button.click();
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
  popup.closed = true;
  await vi.advanceTimersByTimeAsync(500);
  expect((await result).detail).toEqual({ status: 'closed', reason: 'unreachable', session_id: 'fian_cs_1' });
  const status = el.shadowRoot!.querySelector('.fianto-status')!;
  expect(status.textContent).toBe('Lost track of the checkout window. Check your order status before trying again.');
  expect(status.textContent).not.toMatch(/not (been )?charged|nothing was charged/i);
  expect(button.getAttribute('aria-busy')).toBe('false');
  expect(button.getAttribute('aria-disabled')).toBe('true');
  button.click();
  expect(open).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(6000);
  expect(button.hasAttribute('aria-disabled')).toBe(false);
  expect(status.textContent).toContain('Check your order status'); // stays until the next attempt
  popup.closed = false;
  button.click();
  expect(open).toHaveBeenCalledTimes(2);
  expect(status.textContent).toBe('');
});

it('shows no message when the payer closed the popup', async () => {
  vi.useFakeTimers();
  const popup = fakePopup();
  vi.stubGlobal('open', vi.fn(() => popup));
  const { el, button } = mount();
  el.session = { id: 'fian_cs_1', url: 'https://pay.test/c/x' };
  const result = new Promise<CustomEvent>((resolve) => el.addEventListener('fianto:result', (e) => resolve(e as CustomEvent)));
  button.click();
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(3000);
  popup.closed = true;
  await vi.advanceTimersByTimeAsync(500);
  expect((await result).detail).toMatchObject({ status: 'closed', reason: 'closed_by_payer' });
  expect(el.shadowRoot!.querySelector('.fianto-status')!.textContent).toBe('');
  expect(button.hasAttribute('aria-disabled')).toBe(false);
});

// D3: the route's code picks payer copy; the route's message (written for the merchant) is
// never shown to the payer, only passed on in fianto:error.
it.each([
  [409, 'order_already_paid', 'This order has already been paid.'],
  [429, 'rate_limited', 'Checkout is busy right now. Please try again shortly.'],
  [409, 'checkout_unavailable', 'Checkout is busy right now. Please try again shortly.'],
  [409, 'order_session_mismatch', 'This checkout changed — reload the page and try again.'],
  [409, 'plan_limit_reached', "Checkout isn't available right now."],
  [400, 'validation_failed', 'Checkout could not be started. Please try again.'],
  [500, 'internal_error', 'Checkout could not be started. Please try again.'],
])('on a %i %s shows payer copy and passes the route message in fianto:error', async (httpStatus, code, copy) => {
  vi.stubGlobal('open', vi.fn(() => fakePopup()));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code, message: 'route message for the merchant' } }), { status: httpStatus })));
  const { el, button } = mount({ 'session-endpoint': '/api/checkout', locale: 'en' });
  const error = new Promise<CustomEvent>((resolve) => el.addEventListener('fianto:error', (e) => resolve(e as CustomEvent)));
  button.click();
  expect((await error).detail).toEqual({ code, message: 'route message for the merchant' });
  expect(el.shadowRoot!.querySelector('.fianto-status')!.textContent).toBe(copy);
});

it('keeps native disabled for the disabled attribute', () => {
  const { button } = mount({ disabled: '' });
  expect(button.disabled).toBe(true);
});

it('falls back to logo-only when the label overflows, and back when it fits', () => {
  let contentWidth = 300;
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('fianto-content') ? contentWidth : 0;
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(100);
  const { el } = mount();
  expect(el.shadowRoot!.querySelector('button')!.classList.contains('fianto-plain')).toBe(true);
  contentWidth = 80;
  el.setAttribute('theme', 'dark');
  expect(el.shadowRoot!.querySelector('button')!.classList.contains('fianto-plain')).toBe(false);
});

// The host is display: inline, and ResizeObserver never fires for an inline box: observe the
// inner button and the container instead, and stop on disconnect.
it('watches the inner button and its container for resizes, not the inline host', () => {
  const observers: { observed: Element[]; disconnected: boolean }[] = [];
  vi.stubGlobal('ResizeObserver', class {
    record = { observed: [] as Element[], disconnected: false };
    constructor() { observers.push(this.record); }
    observe(target: Element) { this.record.observed.push(target); }
    disconnect() { this.record.disconnected = true; }
  });
  const wrap = document.createElement('div');
  document.body.append(wrap);
  const el = document.createElement('fianto-button') as FiantoButtonElement;
  wrap.append(el);
  const button = el.shadowRoot!.querySelector('button')!;
  expect(observers.at(-1)!.observed).toEqual([button, wrap]);
  expect(observers.at(-1)!.observed).not.toContain(el);
  el.remove();
  expect(observers.at(-1)!.disconnected).toBe(true);
});

it('leaves loading when a redirected page returns from the bfcache', async () => {
  vi.stubGlobal('open', vi.fn(() => null));
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  const { el, button } = mount({ fallback: 'redirect' });
  el.session = { id: 'fian_cs_1', url: 'https://pay.test/c/x' };
  const result = new Promise<CustomEvent>((resolve) => el.addEventListener('fianto:result', (e) => resolve(e as CustomEvent)));
  button.click();
  await vi.waitFor(() => expect(assign).toHaveBeenCalled());
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: true });
  window.dispatchEvent(event);
  expect((await result).detail).toEqual({ status: 'closed', reason: 'returned_from_redirect', session_id: 'fian_cs_1' });
  expect(button.getAttribute('aria-busy')).toBe('false');
});
