import { describe, it, expect, beforeEach, vi } from 'vitest';

// fix-87: window-level error + unhandledrejection capture.

const logErrorMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../lib/errorLogger', () => ({
  logError: logErrorMock,
  messageOf: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import {
  installGlobalErrorHandlers,
  __resetGlobalErrorHandlersForTests,
} from '../lib/globalErrorHandlers';

beforeEach(() => {
  __resetGlobalErrorHandlersForTests();
  logErrorMock.mockReset();
  installGlobalErrorHandlers();
});

describe('globalErrorHandlers (fix-87)', () => {
  it('window error event → logError(source=frontend_exception) with message + filename + lineno', () => {
    const ev = new ErrorEvent('error', {
      message: 'TypeError: x is not a function',
      filename: '/assets/app.js',
      lineno: 42,
      colno: 7,
      error: Object.assign(new Error('TypeError: x is not a function'), {
        stack: 'TypeError: x is not a function\n  at app.js:42:7',
      }),
    });
    window.dispatchEvent(ev);

    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const arg = logErrorMock.mock.calls[0][0];
    expect(arg.source).toBe('frontend_exception');
    expect(arg.level).toBe('error');
    expect(arg.message).toContain('TypeError');
    expect(arg.context.filename).toBe('/assets/app.js');
    expect(arg.context.lineno).toBe(42);
    expect(arg.context.stack).toContain('app.js:42:7');
  });

  it('unhandledrejection event → logError with the rejection reason', () => {
    // Build a synthetic PromiseRejectionEvent. We don't attach a real
    // rejected promise to `.promise` — jsdom would fire its own
    // unhandledrejection event for that, double-counting our handler.
    // A resolved-promise stand-in is enough for the handler's reads.
    const reason = new Error('boom');
    const ev = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(ev, 'reason', { value: reason });
    Object.defineProperty(ev, 'promise', { value: Promise.resolve() });
    window.dispatchEvent(ev);

    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const arg = logErrorMock.mock.calls[0][0];
    expect(arg.source).toBe('frontend_exception');
    expect(arg.message).toBe('boom');
    expect(typeof arg.context.stack === 'string').toBe(true);
  });

  it('install is idempotent (calling twice does not double-fire on a single window event)', () => {
    installGlobalErrorHandlers(); // second call — should be a no-op
    window.dispatchEvent(new ErrorEvent('error', { message: 'once' }));
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });
});
