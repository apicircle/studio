import { useCallback, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';

// Imperative store access. Subscribing via the hook re-renders the
// consumer on every toast push, which is overkill — we only need the
// pushToast function reference (stable across renders by zustand).
const pushToastDirect = (
  toast: Parameters<ReturnType<typeof useWorkspaceStore.getState>['pushToast']>[0],
): string => useWorkspaceStore.getState().pushToast(toast);

export type AsyncStatus = 'idle' | 'running' | 'success' | 'error';

interface UseAsyncOpResult<TArgs extends unknown[], TResult> {
  /**
   * Invoke the wrapped fn. Returns the resolved value on success, or
   * `null` on failure (the error is surfaced via toast — the caller does
   * not need to try/catch). The error is also exposed via `error` for
   * inline rendering when desired.
   */
  run: (...args: TArgs) => Promise<TResult | null>;
  status: AsyncStatus;
  error: Error | null;
  /** True while `run` is in flight. Shortcut for `status === 'running'`. */
  busy: boolean;
}

interface UseAsyncOpOptions {
  /** Title for the error toast (defaults to "Action failed"). */
  errorTitle?: string;
  /**
   * Optional success toast. When omitted, success is silent (success
   * usually has its own UI affordance; toasting every successful op is
   * noisy).
   */
  successTitle?: string;
  /** When false, suppress the error toast (caller wants to render inline). */
  toastOnError?: boolean;
}

/**
 * Async-op wrapper used to surface errors that previously vanished via
 * `void asyncFn()` discards. Captures the result + error and routes
 * failures through the workspace toast slice so the user sees something
 * even if the call site forgot to handle the rejection.
 *
 * Usage:
 *   const remove = useAsyncOp(removeEnvironment, { errorTitle: 'Delete failed' });
 *   await remove.run('staging'); // null on failure, value on success
 */
export function useAsyncOp<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult,
  options: UseAsyncOpOptions = {},
): UseAsyncOpResult<TArgs, TResult> {
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      setStatus('running');
      setError(null);
      try {
        const result = await fn(...args);
        setStatus('success');
        if (options.successTitle) {
          pushToastDirect({ tone: 'success', title: options.successTitle });
        }
        return result;
      } catch (err) {
        const errObj = err instanceof Error ? err : new Error(String(err));
        setError(errObj);
        setStatus('error');
        if (options.toastOnError !== false) {
          pushToastDirect({
            tone: 'error',
            title: options.errorTitle ?? 'Action failed',
            detail: errObj.message,
          });
        }
        return null;
      }
    },
    [fn, options.errorTitle, options.successTitle, options.toastOnError],
  );

  return { run, status, error, busy: status === 'running' };
}
