// @vitest-environment jsdom
import axe from 'axe-core';
import { defineFiantoButton, FiantoButtonElement } from './index.js';
import { MESSAGE_TYPE } from '../index.js';

defineFiantoButton();

function mount(attrs: Record<string, string> = {}) {
  const el = document.createElement('fianto-button') as FiantoButtonElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  const button = el.shadowRoot!.querySelector('button')!;
  return { el, button };
}

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

it('keeps focus while loading and ignores a second click', async () => {
  const popup = { closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {} };
  const open = vi.fn(() => popup);
  vi.stubGlobal('open', open);
  const { el, button } = mount();
  el.session = { id: 'fian_cs_1', url: 'https://pay.test/c/x' };
  button.focus();
  button.click();
  expect(el.shadowRoot!.activeElement).toBe(button);
  button.click();
  expect(open).toHaveBeenCalledTimes(1);
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
  expect((await result).detail).toEqual({ status: 'closed', session_id: 'fian_cs_1' });
  expect(button.getAttribute('aria-busy')).toBe('false');
});
