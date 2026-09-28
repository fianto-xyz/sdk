// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { FiantoCheckoutError } from '@fianto/js';
import { CheckoutSessionError, fetchCheckoutSession } from './index.js';
import { FiantoButton } from './fianto-button.js';

// @fianto/js's internal postMessage type (not exported from its public entry).
const MESSAGE_TYPE = 'fianto.checkout';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountPopup() {
  const popup = { closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {}, focus: vi.fn() };
  vi.stubGlobal('open', vi.fn(() => popup));
  return popup;
}

async function flush() {
  // Native-promise microtasks settle without timers, so this works under fake timers too.
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

it('renders an accessible button with the forwarded ref and appended className', () => {
  const ref = createRef<HTMLButtonElement>();
  const { container } = render(
    <FiantoButton ref={ref} session={{ id: 'fian_cs_1', url: 'https://pay.test/c/x' }} label="checkout" theme="light" className="extra" />,
  );
  const button = container.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Check out with fianto');
  expect(button.className).toContain('fianto-theme-light');
  expect(button.className).toContain('fianto-label-checkout');
  expect(button.className).toContain('extra');
  expect(ref.current).toBe(button);
});

it('opens checkout synchronously on click and reports the result via onResult', async () => {
  const popup = mountPopup();
  const onResult = vi.fn();
  const { container } = render(
    <FiantoButton session={{ id: 'fian_cs_1', url: 'https://pay.test/c/x' }} onResult={onResult} />,
  );
  const button = container.querySelector('button')!;
  fireEvent.click(button);
  expect(window.open).toHaveBeenCalled();
  await waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: MESSAGE_TYPE, session_id: 'fian_cs_1', status: 'succeeded' },
        origin: 'https://pay.test',
        source: popup as unknown as MessageEventSource,
      }),
    );
  });
  await waitFor(() => expect(onResult).toHaveBeenCalledWith({ status: 'succeeded', session_id: 'fian_cs_1' }));
});

it('shows the in-progress message and calls onError on a 409 FiantoCheckoutError', async () => {
  mountPopup();
  const onError = vi.fn();
  const { container } = render(
    <FiantoButton
      session={async () => {
        throw new FiantoCheckoutError('payment_in_progress', 'A payment for this order is already in progress.');
      }}
      onError={onError}
    />,
  );
  const button = container.querySelector('button')!;
  fireEvent.click(button);
  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  const error = onError.mock.calls[0]?.[0];
  expect(error).toBeInstanceOf(FiantoCheckoutError);
  expect((error as FiantoCheckoutError).code).toBe('payment_in_progress');
  const status = container.querySelector('.fianto-status')!;
  expect(status.textContent).toBe('A payment for this order is already in progress.');
});

it('clears the 6s status timer on unmount, not just on a later re-render', async () => {
  // Fake timers so the 6s status-clear timeout never actually fires during the test; we only
  // assert it gets cleared, not that it would eventually run.
  vi.useFakeTimers();
  mountPopup();
  const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
  const { container, unmount } = render(
    <FiantoButton
      session={async () => {
        throw new FiantoCheckoutError('payment_in_progress', 'x');
      }}
    />,
  );
  const button = container.querySelector('button')!;
  await act(async () => {
    fireEvent.click(button);
    // Flush the native-promise microtask chain (session() rejecting -> resolveSession ->
    // openCheckout's catch -> the hook's .then) without relying on any timer: fake timers only
    // replace macrotasks (setTimeout/setInterval), so plain microtask ticks still settle it.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  expect(container.querySelector('.fianto-status')!.textContent).toBe('A payment for this order is already in progress.');
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  clearTimeoutSpy.mockClear();
  unmount();
  expect(clearTimeoutSpy).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it('keeps focus while loading via aria-disabled; native disabled only for the prop', async () => {
  const popup = mountPopup();
  const { container, rerender } = render(<FiantoButton session={{ id: 'fian_cs_1', url: 'https://pay.test/c/x' }} />);
  const button = container.querySelector('button')!;
  button.focus();
  fireEvent.click(button);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(button.disabled).toBe(false);
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(popup.focus).toHaveBeenCalledOnce(); // D4: a busy click brings the popup back
  rerender(<FiantoButton session={{ id: 'fian_cs_1', url: 'https://pay.test/c/x' }} disabled />);
  expect(button.disabled).toBe(true);
});

it('watches the button and its container for resizes', () => {
  const observed: Element[] = [];
  vi.stubGlobal('ResizeObserver', class {
    observe(target: Element) { observed.push(target); }
    disconnect() {}
  });
  const { container } = render(<div id="wrap"><FiantoButton session={{ id: 'fian_cs_1', url: 'https://pay.test/c/x' }} /></div>);
  expect(observed).toEqual([container.querySelector('button'), container.querySelector('#wrap')]);
});

it('re-exports the whole @fianto/js error set', async () => {
  const js = await import('@fianto/js');
  const react = await import('./index.js');
  for (const name of ['FiantoCheckoutError', 'CheckoutSessionError', 'InvalidSessionError', 'PopupBlockedError'] as const) {
    expect(react[name]).toBe(js[name]);
  }
});

it('falls back to logo-only when the label overflows', () => {
  let contentWidth = 300;
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('fianto-content') ? contentWidth : 0;
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(100);
  const session = { id: 'fian_cs_1', url: 'https://pay.test/c/x' };
  const { container, rerender } = render(<FiantoButton session={session} />);
  expect(container.querySelector('button')!.classList.contains('fianto-plain')).toBe(true);
  contentWidth = 80;
  rerender(<FiantoButton session={session} theme="dark" />);
  expect(container.querySelector('button')!.classList.contains('fianto-plain')).toBe(false);
  vi.restoreAllMocks();
});

// D3: fetchCheckoutSession (re-exported here) keeps the route's code; the payer sees copy chosen
// by that code, never the route's own message.
it.each([
  [409, 'payment_in_progress', 'A payment for this order is already in progress.'],
  [429, 'rate_limited', 'Checkout is busy right now. Please try again shortly.'],
  [400, 'validation_failed', 'Checkout could not be started. Please try again.'],
])('with fetchCheckoutSession, a %i %s shows payer copy and hands onError the typed error', async (httpStatus, code, copy) => {
  mountPopup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code, message: 'route message for the merchant' } }), { status: httpStatus })));
  const onError = vi.fn();
  const { container } = render(<FiantoButton locale="en" session={() => fetchCheckoutSession('/api/checkout', { body: { orderId: 'o_1' } })} onError={onError} />);
  fireEvent.click(container.querySelector('button')!);
  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  expect(onError.mock.calls[0]![0]).toBeInstanceOf(CheckoutSessionError);
  expect(onError.mock.calls[0]![0]).toMatchObject({ code, status: httpStatus });
  expect(container.querySelector('.fianto-status')!.textContent).toBe(copy);
});

// D1
it('on an unreachable popup shows the lost-window message and holds the button before re-enabling', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const popup = mountPopup();
  const onResult = vi.fn();
  const { container } = render(<FiantoButton locale="en" session={{ id: 'fian_cs_1', url: 'https://pay.test/c/x' }} onResult={onResult} />);
  const button = container.querySelector('button')!;
  await act(async () => {
    fireEvent.click(button);
    await flush();
  });
  expect(popup.location.replace).toHaveBeenCalled();
  popup.closed = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(onResult).toHaveBeenCalledWith({ status: 'closed', reason: 'unreachable', session_id: 'fian_cs_1' });
  const status = container.querySelector('.fianto-status')!;
  expect(status.textContent).toBe('Lost track of the checkout window. Check your order status before trying again.');
  expect(button.getAttribute('aria-busy')).toBe('false');
  expect(button.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(button);
  expect(window.open).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(button.hasAttribute('aria-disabled')).toBe(false);
  expect(status.textContent).toContain('Check your order status');
  popup.closed = false;
  await act(async () => {
    fireEvent.click(button);
    await flush();
  });
  expect(window.open).toHaveBeenCalledTimes(2);
  expect(status.textContent).toBe('');
});
