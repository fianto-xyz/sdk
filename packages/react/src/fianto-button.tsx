import { forwardRef, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FiantoCheckoutError } from '@fianto/js';
import type { CheckoutResult, CheckoutSessionSource } from '@fianto/js';
import { BUTTON_CSS, buttonClassName, buttonMarkup, buttonText, ERROR_TEXT, resolveButtonOptions } from '@fianto/js/button-core';
import type { ButtonOptions } from '@fianto/js/button-core';
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
  const { open, status, result, error } = useCheckout({ session, fallback });
  const [statusText, setStatusText] = useState('');
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastResult = useRef<CheckoutResult | null>(null);
  const lastError = useRef<FiantoCheckoutError | Error | null>(null);

  useEffect(
    () => () => {
      if (statusTimer.current !== undefined) clearTimeout(statusTimer.current);
    },
    [],
  );

  // A fresh open() clears any error text left over from a previous attempt.
  useEffect(() => {
    if (status === 'open') {
      setStatusText('');
      if (statusTimer.current !== undefined) {
        clearTimeout(statusTimer.current);
        statusTimer.current = undefined;
      }
    }
  }, [status]);

  // Fire the callbacks as a side effect of the hook's state settling (not inline in the click
  // handler's `.then`), so a stale closure over `onResult`/`onError` can never fire twice for the
  // same settle and a re-render always sees the latest callback props.
  useEffect(() => {
    if (result && result !== lastResult.current) {
      lastResult.current = result;
      onResult?.(result);
    }
  }, [result, onResult]);

  useEffect(() => {
    if (error && error !== lastError.current) {
      lastError.current = error;
      onError?.(error);
      const code = error instanceof FiantoCheckoutError ? error.code : 'unknown';
      setStatusText(ERROR_TEXT[resolved.locale][code === 'payment_in_progress' ? 'payment_in_progress' : 'generic']);
      if (statusTimer.current !== undefined) clearTimeout(statusTimer.current);
      statusTimer.current = setTimeout(() => setStatusText(''), ERROR_DISPLAY_MS);
    }
  }, [error, onError, resolved.locale]);

  const busy = resolved.loading || status === 'open';
  const ariaLabel = buttonText(resolved.label, resolved.locale).ariaLabel;
  const resolvedClassName = className ? `${buttonClassName(resolved)} ${className}` : buttonClassName(resolved);

  const handleClick = (): void => {
    void open();
  };

  return (
    <>
      <style href="fianto-button" precedence="default">
        {BUTTON_CSS}
      </style>
      <button
        ref={ref}
        type="button"
        className={resolvedClassName}
        style={style}
        aria-label={ariaLabel}
        aria-busy={busy}
        disabled={resolved.disabled || busy}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: buttonMarkup(resolved) }}
      />
      <p className="fianto-status" role="status" aria-live="polite">
        {statusText}
      </p>
    </>
  );
});
