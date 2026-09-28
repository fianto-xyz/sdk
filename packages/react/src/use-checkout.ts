import { useCallback, useRef, useState } from 'react';
import { openCheckout } from '@fianto/js';
import type { CheckoutResult, CheckoutSessionSource } from '@fianto/js';
import { FiantoCheckoutError } from '@fianto/js';

export interface UseCheckoutOptions {
  session: CheckoutSessionSource;
  fallback?: 'redirect' | 'none';
}

export type CheckoutHookStatus = 'idle' | 'open' | 'done' | 'error';

export interface UseCheckoutResult {
  /** Call synchronously from an event handler: it calls `openCheckout` before any `await`. */
  open: () => Promise<CheckoutResult | undefined>;
  status: CheckoutHookStatus;
  result: CheckoutResult | null;
  error: FiantoCheckoutError | Error | null;
  isOpen: boolean;
}

/**
 * Tracks one `openCheckout` call in React state. `open()` never throws — on failure it records
 * `error`/`status: 'error'` and resolves `undefined`, so a caller can always `await open()`
 * without a try/catch and read `error` for the message.
 */
export function useCheckout(options: UseCheckoutOptions): UseCheckoutResult {
  // A ref, not a dependency: `open`'s identity stays stable across renders while always reading
  // the latest `session`/`fallback` at call time.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [status, setStatus] = useState<CheckoutHookStatus>('idle');
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState<FiantoCheckoutError | Error | null>(null);

  const open = useCallback((): Promise<CheckoutResult | undefined> => {
    setStatus('open');
    setResult(null);
    setError(null);
    const { session, fallback } = optionsRef.current;
    // No `await` above this line: `openCheckout` (and the `window.open` inside it) runs
    // synchronously within the caller's event handler, so the popup blocker allows it.
    return openCheckout({ session, fallback }).then(
      (value) => {
        setResult(value);
        setStatus('done');
        return value;
      },
      (thrown: unknown) => {
        setError(thrown instanceof Error ? thrown : new Error(String(thrown)));
        setStatus('error');
        return undefined;
      },
    );
  }, []);

  return { open, status, result, error, isOpen: status === 'open' };
}
