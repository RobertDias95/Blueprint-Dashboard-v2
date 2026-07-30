import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { logError } from '../lib/errorLogger';

// fix-260: React Router's RouterProvider catches render errors thrown inside a
// route element BEFORE they can reach the app-level ErrorBoundary in main.tsx
// (that boundary is mounted outside the router). The consequence was worse than
// the ugly default page: nothing reached logError, so route crashes never
// appeared in Settings → Errors at all. A null reviewer_name blew up
// ProjectDetail and left no trace.
//
// This is the route's errorElement — it logs through the same path as fix-87
// and shows the same shape of fallback, so a route crash is finally visible.

export default function RouteErrorFallback() {
  const error = useRouteError();

  useEffect(() => {
    void logError({
      source: 'frontend_exception',
      level: 'error',
      message:
        error instanceof Error
          ? error.message
          : String(error ?? 'route render error'),
      context: {
        stack: error instanceof Error ? error.stack : undefined,
        kind: 'react_router_error_element',
        url:
          typeof window !== 'undefined'
            ? window.location?.pathname
            : undefined,
      },
    });
  }, [error]);

  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown');

  return (
    <div
      className="min-h-[60vh] flex items-center justify-center p-6"
      data-testid="route-error-fallback"
    >
      <div className="max-w-md bg-surface border border-co-border rounded-xl p-6 text-sm">
        <div className="font-display font-bold text-co text-base mb-2">
          This page couldn't load.
        </div>
        <div className="text-muted mb-4">
          The team's been notified — the details are in Settings → Errors. The
          rest of the app is still working.
        </div>
        {message && (
          <div className="text-[11px] font-mono text-dim bg-bg border border-border rounded p-2 mb-4 break-all">
            {message}
          </div>
        )}
        <button
          type="button"
          onClick={() => window.location.assign('/')}
          className="text-xs px-3 py-1.5 rounded bg-de text-white font-display font-semibold hover:opacity-90 transition"
          data-testid="route-error-home"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
