import { useCallback, useRef, useState } from 'react';
import { focusCheckout, openCheckout } from '@fianto/js';
import type { CheckoutResult, CheckoutSessionSource, FiantoCheckoutError } from '@fianto/js';

export interface UseCheckoutOptions {
  /** `{ id, url }`, or a function returning it — e.g. `() => fetchCheckoutSession('/api/checkout')`. */
  session: CheckoutSessionSource;
  fallback?: 'redirect' | 'none';
}

export type CheckoutHookStatus = 'idle' | 'open' | 'done' | 'error';

export interface UseCheckoutResult {
  /** Call synchronously from an event handler: it calls `openCheckout` before any `await`. */
  open: () => Promise<CheckoutResult | undefined>;
  /** Brings the open checkout popup to the front (call it on a click while `isOpen`). `false` if there is none. */
  focus: () => boolean;
  status: CheckoutHookStatus;
  result: CheckoutResult | null;
  error: FiantoCheckoutError | Error | null;
  isOpen: boolean;
}

/**
 * Tracks one `openCheckout` call in React state. `open()` never throws — on failure it records
 * `error`/`status: 'error'` and resolves `undefined`, so a caller can always `await open()`
 * without a try/catch and read `error` for the message. Only the latest `open()` drives the
 * state: an earlier call it superseded still resolves its own promise, but never reports `done`
 * while the newer checkout is open.
 */
export function useCheckout(options: UseCheckoutOptions): UseCheckoutResult {
  // A ref, not a dependency: `open`'s identity stays stable across renders while always reading
  // the latest `session`/`fallback` at call time.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const latest = useRef(0);

  const [status, setStatus] = useState<CheckoutHookStatus>('idle');
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState<FiantoCheckoutError | Error | null>(null);

  const open = useCallback((): Promise<CheckoutResult | undefined> => {
    const call = ++latest.current;
    setStatus('open');
    setResult(null);
    setError(null);
    const { session, fallback } = optionsRef.current;
    // No `await` above this line: `openCheckout` (and the `window.open` inside it) runs
    // synchronously within the caller's event handler, so the popup blocker allows it.
    return openCheckout({ session, fallback }).then(
      (value) => {
        if (call === latest.current) {
          setResult(value);
          setStatus('done');
        }
        return value;
      },
      (thrown: unknown) => {
        if (call === latest.current) {
          setError(thrown instanceof Error ? thrown : new Error(String(thrown)));
          setStatus('error');
        }
        return undefined;
      },
    );
  }, []);

  return { open, focus: focusCheckout, status, result, error, isOpen: status === 'open' };
}
