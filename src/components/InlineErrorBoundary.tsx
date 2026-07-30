import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../lib/errorLogger';

// fix-260: a CARD-SIZED error boundary.
//
// Two separate gaps made a single bad row able to blank a whole page:
//
//   1. The app-level ErrorBoundary (fix-87) is mounted in main.tsx OUTSIDE the
//      router. React Router's RouterProvider catches render errors thrown
//      inside a route element FIRST and renders its own built-in "Unexpected
//      Application Error" page, so the fix-87 boundary never sees them — and,
//      worse, nothing reaches logError, so those crashes never appear in
//      Settings → Errors. A whole class of route crashes was invisible.
//
//   2. Even when caught, an app-level boundary replaces the entire screen. One
//      unrenderable reviewer chip should cost you that chip, not the project.
//
// This boundary is deliberately small: it renders an inline notice sized to sit
// inside a table cell or card, and it logs through the same logError path as
// fix-87 so the incident still lands in error_reports.
//
// Use it around a leaf that renders server data whose shape you do not fully
// control. It is NOT a substitute for fixing the underlying null — it is the
// blast-radius limiter for the next one.

interface Props {
  children: ReactNode;
  /** Short label for the thing that failed, e.g. "reviewers". Shown to the
   *  user and attached to the log so the report is greppable. */
  label: string;
  /** Optional testid for the fallback node. */
  testId?: string;
}

interface State {
  hasError: boolean;
}

export default class InlineErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    void logError({
      source: 'frontend_exception',
      level: 'error',
      message:
        error instanceof Error
          ? error.message
          : String(error ?? 'inline render error'),
      context: {
        stack: error instanceof Error ? error.stack : undefined,
        componentStack: info.componentStack ?? '',
        kind: 'react_inline_boundary',
        label: this.props.label,
        url:
          typeof window !== 'undefined'
            ? window.location?.pathname
            : undefined,
      },
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <span
        className="text-[10px] italic"
        style={{ color: 'var(--color-co)' }}
        title={`The ${this.props.label} cell failed to render. The error has been logged to Settings → Errors.`}
        data-testid={this.props.testId ?? 'inline-error-boundary-fallback'}
      >
        {this.props.label} unavailable
      </span>
    );
  }
}
