// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { FiantoCheckoutError, MESSAGE_TYPE } from '@fianto/js';
import { FiantoButton } from './fianto-button.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mountPopup() {
  const popup = { closed: false, location: { replace: vi.fn() }, document: document.implementation.createHTMLDocument(''), close() {} };
  vi.stubGlobal('open', vi.fn(() => popup));
  return popup;
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
