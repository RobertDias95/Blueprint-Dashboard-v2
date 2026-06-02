import { describe, it, expect, beforeEach, vi } from 'vitest';

// fix-87: error toasts also call logError. We mock the logger module so
// the existing toastStore.test.ts coverage stays focused on push/dismiss
// timing; this file is just about the new logging side-channel.

const logErrorMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../lib/errorLogger', () => ({
  logError: logErrorMock,
  messageOf: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { useToastStore, pushToast } from '../stores/toastStore';

beforeEach(() => {
  useToastStore.getState().clear();
  logErrorMock.mockReset();
});

describe('toastStore → bp_log_error (fix-87)', () => {
  it('an error toast calls logError once with source=frontend_toast', () => {
    pushToast('Something failed to save', 'error');
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0][0]).toMatchObject({
      source: 'frontend_toast',
      level: 'error',
      message: 'Something failed to save',
    });
    // The context carries the current URL — jsdom default is '/'.
    expect(logErrorMock.mock.calls[0][0].context.url).toBe('/');
  });

  it('a success / info / warn toast does NOT log', () => {
    pushToast('Saved', 'success');
    pushToast('FYI', 'info');
    pushToast('Watch out', 'warn');
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
