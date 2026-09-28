import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FiantoCheckoutError } from '@fianto/js';
import type { CheckoutResult, CheckoutSessionSource } from '@fianto/js';
import { applyOverflowFallback, BUTTON_CSS, buttonClassName, buttonMarkup, buttonText, errorTextKey, observeOverflow, resolveButtonOptions, STATUS_TEXT } from '@fianto/js/button-core';
import type { ButtonOptions, StatusTextKey } from '@fianto/js/button-core';
import { useCheckout } from './use-checkout.js';

export interface FiantoButtonProps extends ButtonOptions {
  session: CheckoutSessionSource;
  fallback?: 'redirect' | 'none';
  onResult?: (result: CheckoutResult) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: CSSProperties;
}

const ERROR_DISPLAY_MS = 6000;

// useLayoutEffect on the client (checks overflow before paint); useEffect on the server, where
// neither runs, so SSR never touches the DOM.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Native React markup from the shared button-core module (not the `<fianto-button>` custom
 * element), so SSR in Next.js has no hydration flash. Renders nothing that reads `window` —
 * `open()` only runs from the click handler.
 */
export const FiantoButton = forwardRef<HTMLButtonElement, FiantoButtonProps>(function FiantoButton(
  { session, fallback, onResult, onError, className, style, theme, label, shape, size, locale, loading, disabled },
  ref,
) {
  // `locale` resolves only from the explicit prop during render — never from `navigator`, which
  // differs between the server and a non-English browser and would otherwise mismatch React's
  // hydration check. Once mounted, an effect adopts the navigator-derived locale into state (only
  // when no `locale` prop was given), so the button settles into the visitor's language on the
  // client without ever touching `navigator` during render itself.
  const [autoLocale, setAutoLocale] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (locale === undefined && typeof navigator !== 'undefined') setAutoLocale(navigator.language);
  }, [locale]);

  const resolved = resolveButtonOptions({ theme, label, shape, size, locale, loading, disabled }, autoLocale);
  const { open, focus, status, result, error } = useCheckout({ session, fallback });
  // A key into button-core's payer copy, never an error's own message (written for the merchant).
  const [statusKey, setStatusKey] = useState<StatusTextKey | null>(null);
  // The checkout window was lost (result unknown): hold the button while the payer reads why.
  const [held, setHeld] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastResult = useRef<CheckoutResult | null>(null);
  const lastError = useRef<FiantoCheckoutError | Error | null>(null);

  useEffect(
    () => () => {
      if (statusTimer.current !== undefined) clearTimeout(statusTimer.current);
    },
    [],
  );

  const showStatus = (key: StatusTextKey | null, hold = false): void => {
    setStatusKey(key);
    setHeld(hold);
    if (statusTimer.current !== undefined) clearTimeout(statusTimer.current);
    statusTimer.current = undefined;
    if (key) {
      statusTimer.current = setTimeout(() => {
        statusTimer.current = undefined;
        // A lost-window message stays until the next attempt; only the hold ends.
        if (hold) setHeld(false);
        else setStatusKey(null);
      }, ERROR_DISPLAY_MS);
    }
  };

  // A fresh open() clears any text left over from a previous attempt.
  useEffect(() => {
    if (status === 'open') showStatus(null);
  }, [status]);

  // Fire the callbacks as a side effect of the hook's state settling (not inline in the click
  // handler's `.then`), so a stale closure over `onResult`/`onError` can never fire twice for the
  // same settle and a re-render always sees the latest callback props.
  useEffect(() => {
    if (result && result !== lastResult.current) {
      lastResult.current = result;
      if (result.status === 'closed' && result.reason === 'unreachable') showStatus('lost', true);
      onResult?.(result);
    }
  }, [result, onResult]);

  useEffect(() => {
    if (error && error !== lastError.current) {
      lastError.current = error;
      onError?.(error);
      showStatus(errorTextKey(error instanceof FiantoCheckoutError ? error.code : undefined));
    }
  }, [error, onError]);

  const buttonRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => buttonRef.current as HTMLButtonElement, []);

  // Every render: React rewrites className (dropping fianto-plain) when props change.
  useIsomorphicLayoutEffect(() => {
    if (buttonRef.current) applyOverflowFallback(buttonRef.current);
  });
  useIsomorphicLayoutEffect(() => {
    const button = buttonRef.current;
    return button ? observeOverflow(button, button.parentElement) : undefined;
  }, []);

  const busy = resolved.loading || status === 'open';
  const ariaLabel = buttonText(resolved.label, resolved.locale).ariaLabel;
  const resolvedClassName = className ? `${buttonClassName(resolved)} ${className}` : buttonClassName(resolved);

  const handleClick = (): void => {
    // Loading keeps the button focusable (aria-disabled, not native disabled), so guard here.
    if (resolved.disabled) return;
    // Busy: the popup may have gone behind the page. Bring it back rather than open another.
    if (busy) {
      focus();
      return;
    }
    if (!held) void open();
  };

  return (
    <>
      <style href="fianto-button" precedence="default">
        {BUTTON_CSS}
      </style>
      <button
        ref={buttonRef}
        type="button"
        className={resolvedClassName}
        style={style}
        aria-label={ariaLabel}
        aria-busy={busy}
        aria-disabled={busy || held ? true : undefined}
        disabled={resolved.disabled}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: buttonMarkup(resolved) }}
      />
      <p className="fianto-status" role="status" aria-live="polite">
        {statusKey ? STATUS_TEXT[resolved.locale][statusKey] : ''}
      </p>
    </>
  );
});
