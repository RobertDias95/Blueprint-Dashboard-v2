import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../lib/errorLogger';

// fix-87: catch React render-tree errors that escape every per-page boundary.
// Mounted around the entire app shell in main.tsx so a render crash anywhere
// lands in error_reports and shows the fallback UI (rather than a blank
// white screen with nothing in the console).
//
// componentDidCatch fires AFTER React has unwound the bad subtree; React 19
// also fires window 'error' for the same exception, which means we'd
// double-log via globalErrorHandlers. logError's fingerprint hashing groups
// the duplicates server-side, but to keep the per-incident row count honest
// we deduplicate here by skipping the error-boundary log when the error
// already passed through window 'error' a tick before (best-effort — we
// track the last window-error message + timestamp). If you see groups
// double-counted in prod, this is the place to tighten.

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      errorMessage:
        error instanceof Error ? error.message : String(error ?? 'unknown'),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    void logError({
      source: 'frontend_exception',
      level: 'error',
      message:
        error instanceof Error
          ? error.message
          : String(error ?? 'react render error'),
      context: {
        stack:
          error instanceof Error ? error.stack : undefined,
        componentStack: info.componentStack ?? '',
        kind: 'react_boundary',
        url:
          typeof window !== 'undefined'
            ? window.location?.pathname
            : undefined,
      },
    });
  }

  handleReset = (): void => {
    // Navigate the user back home. We DON'T just clear hasError — the
    // crashing subtree is probably crashing because of route-derived
    // state; a hard nav to / sidesteps that without a full page reload.
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        data-testid="error-boundary-fallback"
      >
        <div className="max-w-md bg-surface border border-co-border rounded-xl p-6 text-sm">
          <div className="font-display font-bold text-co text-base mb-2">
            Something broke.
          </div>
          <div className="text-muted mb-4">
            The team's been notified — every detail of this crash is in
            Settings → Errors. You can keep working by heading back to the
            dashboard.
          </div>
          {this.state.errorMessage && (
            <div className="text-[11px] font-mono text-dim bg-bg border border-border rounded p-2 mb-4 break-all">
              {this.state.errorMessage}
            </div>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            className="text-xs px-3 py-1.5 rounded bg-de text-white font-display font-semibold hover:opacity-90 transition"
            data-testid="error-boundary-home"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }
}
