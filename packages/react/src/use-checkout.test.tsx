// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useCheckout } from './use-checkout.js';

// @fianto/js's internal postMessage type (not exported from its public entry).
const MESSAGE_TYPE = 'fianto.checkout';

function fakePopup() {
  return { closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {}, focus: vi.fn() };
}

function post(popup: unknown, sessionId: string, status: string) {
  window.dispatchEvent(new MessageEvent('message', { data: { type: MESSAGE_TYPE, session_id: sessionId, status }, origin: 'https://pay.test', source: popup as MessageEventSource }));
}

it('tracks a checkout from open to done', async () => {
  const popup = { closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {} };
  vi.stubGlobal('open', vi.fn(() => popup));
  const { result } = renderHook(() => useCheckout({ session: { id: 'fian_cs_1', url: 'https://pay.test/c/x' } }));
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.open(); });
  expect(result.current.status).toBe('open');
  expect(result.current.isOpen).toBe(true);
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: MESSAGE_TYPE, session_id: 'fian_cs_1', status: 'canceled' }, origin: 'https://pay.test', source: popup as unknown as MessageEventSource }));
    await pending;
  });
  expect(result.current).toMatchObject({ status: 'done', isOpen: false, result: { status: 'canceled', session_id: 'fian_cs_1' } });
  vi.unstubAllGlobals();
});

it('records an error and resolves undefined', async () => {
  vi.stubGlobal('open', vi.fn(() => ({ closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {} })));
  const { result } = renderHook(() => useCheckout({ session: async () => { throw new Error('nope'); } }));
  let value: unknown;
  await act(async () => { value = await result.current.open(); });
  expect(value).toBeUndefined();
  expect(result.current.status).toBe('error');
  expect(result.current.error?.message).toBe('nope');
  vi.unstubAllGlobals();
});

it('leaves open when a redirected page returns from the bfcache', async () => {
  vi.stubGlobal('open', vi.fn(() => null));
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  const { result } = renderHook(() => useCheckout({ session: { id: 'fian_cs_1', url: 'https://pay.test/c/x' } }));
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.open(); });
  await vi.waitFor(() => expect(assign).toHaveBeenCalled());
  await act(async () => {
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    await pending;
  });
  expect(result.current).toMatchObject({ status: 'done', isOpen: false, result: { status: 'closed', reason: 'returned_from_redirect', session_id: 'fian_cs_1' } });
  vi.unstubAllGlobals();
});

// F20: the first call resolves (superseded) while the second's popup is still open.
it('does not report done while a newer checkout it opened is still open', async () => {
  const popup = fakePopup();
  vi.stubGlobal('open', vi.fn(() => popup));
  let n = 0;
  const { result } = renderHook(() => useCheckout({ session: async () => ({ id: `fian_cs_${++n}`, url: `https://pay.test/c/${n}` }) }));
  let first!: Promise<unknown>;
  act(() => { first = result.current.open(); });
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalledTimes(1));
  let second!: Promise<unknown>;
  await act(async () => {
    second = result.current.open();
    await expect(first).resolves.toEqual({ status: 'closed', reason: 'superseded', session_id: 'fian_cs_1' });
  });
  expect(result.current).toMatchObject({ status: 'open', isOpen: true, result: null });
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalledTimes(2));
  await act(async () => {
    post(popup, 'fian_cs_2', 'succeeded');
    await second;
  });
  expect(result.current).toMatchObject({ status: 'done', result: { status: 'succeeded', session_id: 'fian_cs_2' } });
  vi.unstubAllGlobals();
});

it('does not report an older call failing while a newer checkout is open', async () => {
  const popup = fakePopup();
  vi.stubGlobal('open', vi.fn(() => popup));
  let reject!: (error: Error) => void;
  const sources = [
    () => new Promise<{ id: string; url: string }>((_resolve, fail) => { reject = fail; }),
    async () => ({ id: 'fian_cs_2', url: 'https://pay.test/c/y' }),
  ];
  const { result } = renderHook(() => useCheckout({ session: () => sources.shift()!() }));
  let first!: Promise<unknown>;
  act(() => { first = result.current.open(); });
  act(() => { void result.current.open(); });
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith('https://pay.test/c/y'));
  await act(async () => {
    reject(new Error('stale'));
    await first;
  });
  expect(result.current).toMatchObject({ status: 'open', error: null });
  await act(async () => { post(popup, 'fian_cs_2', 'canceled'); });
  expect(result.current).toMatchObject({ status: 'done', result: { status: 'canceled' } });
  vi.unstubAllGlobals();
});

// D4
it('focus() brings the open popup to the front', async () => {
  const popup = fakePopup();
  vi.stubGlobal('open', vi.fn(() => popup));
  const { result } = renderHook(() => useCheckout({ session: { id: 'fian_cs_1', url: 'https://pay.test/c/x' } }));
  expect(result.current.focus()).toBe(false);
  act(() => { void result.current.open(); });
  expect(result.current.focus()).toBe(true);
  expect(popup.focus).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
    post(popup, 'fian_cs_1', 'canceled');
  });
  vi.unstubAllGlobals();
});
