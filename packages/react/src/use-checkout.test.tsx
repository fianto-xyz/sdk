// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { MESSAGE_TYPE } from '@fianto/js';
import { useCheckout } from './use-checkout.js';

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
  expect(result.current).toMatchObject({ status: 'done', isOpen: false, result: { status: 'closed', session_id: 'fian_cs_1' } });
  vi.unstubAllGlobals();
});
