import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../components/ErrorBoundary';

// fix-87: a render crash anywhere under the boundary lands in
// bp_log_error AND swaps the subtree for the fallback UI. We mock the
// logger so the assertion is purely on the call shape.

const logErrorMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../lib/errorLogger', () => ({
  logError: logErrorMock,
  messageOf: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

function Boom(): never {
  throw new Error('render exploded');
}

beforeEach(() => {
  logErrorMock.mockReset();
});

describe('<ErrorBoundary /> (fix-87)', () => {
  it('catches a render-time throw, logs it, and renders the fallback', () => {
    // React logs its own console.error during a boundary catch. Silence
    // it so the test output stays clean.
    const consoleErr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-home')).toBeInTheDocument();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const arg = logErrorMock.mock.calls[0][0];
    expect(arg.source).toBe('frontend_exception');
    expect(arg.message).toBe('render exploded');
    expect(arg.context.kind).toBe('react_boundary');
    expect(typeof arg.context.componentStack).toBe('string');

    consoleErr.mockRestore();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument();
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
