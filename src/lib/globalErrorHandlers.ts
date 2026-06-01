import { logError, messageOf } from './errorLogger';

// fix-87: catch-everything net for uncaught JS errors. Called once from
// main.tsx so it's mounted before any other code runs. Two listeners:
//
//   * 'error' fires for synchronous uncaught exceptions + asset load
//     failures. Use the ErrorEvent.error stack when present (modern
//     browsers attach it); fall back to message + filename + lineno
//     when it's only partially populated.
//   * 'unhandledrejection' fires for any Promise that rejects without a
//     .catch(). Our QueryClient defaults already cover RPC failures via
//     onError; this catches everything else — fetch() calls, dynamic
//     imports, third-party SDKs.
//
// Both pipe through logError fire-and-forget. The handlers do NOT call
// e.preventDefault() — we want the browser's existing console-error
// behavior to still happen so the dev workflow is untouched.

let installed = false;
// Track the listeners we attach so __resetGlobalErrorHandlersForTests can
// actually detach them (otherwise per-test re-installs would accumulate
// listeners across the file and double-fire on every dispatch).
let attachedErrorListener: ((e: ErrorEvent) => void) | null = null;
let attachedRejectionListener:
  | ((e: PromiseRejectionEvent) => void)
  | null = null;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;
  if (typeof window === 'undefined') return;

  attachedErrorListener = (e: ErrorEvent) => {
    const stack =
      (e.error && typeof e.error === 'object' && 'stack' in e.error
        ? String((e.error as { stack?: unknown }).stack ?? '')
        : '') || undefined;
    void logError({
      source: 'frontend_exception',
      level: 'error',
      message: e.message || messageOf(e.error),
      context: {
        stack,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        url: window.location?.pathname ?? '',
      },
    });
  };
  window.addEventListener('error', attachedErrorListener);

  attachedRejectionListener = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const stack =
      reason && typeof reason === 'object' && 'stack' in reason
        ? String((reason as { stack?: unknown }).stack ?? '')
        : '';
    void logError({
      source: 'frontend_exception',
      level: 'error',
      message: messageOf(reason) || 'unhandled rejection',
      context: {
        stack: stack || undefined,
        url: window.location?.pathname ?? '',
      },
    });
  };
  window.addEventListener('unhandledrejection', attachedRejectionListener);
}

/** Test-only: detach the listeners we installed and reset the gate so a
 *  fresh installGlobalErrorHandlers() runs cleanly. Production code never
 *  calls this — there's only one install for the app's lifetime. */
export function __resetGlobalErrorHandlersForTests(): void {
  if (typeof window !== 'undefined') {
    if (attachedErrorListener)
      window.removeEventListener('error', attachedErrorListener);
    if (attachedRejectionListener)
      window.removeEventListener(
        'unhandledrejection',
        attachedRejectionListener,
      );
  }
  attachedErrorListener = null;
  attachedRejectionListener = null;
  installed = false;
}
