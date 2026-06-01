import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  useToastStore,
  pushToast,
  AUTO_DISMISS_MS,
} from '../stores/toastStore';

// Q3 / fix-86: toast store contract.
//   * Every kind auto-dismisses after AUTO_DISMISS_MS (6 sec) — Bobby's
//     4563 34th Ave W backfill: error toasts used to stick forever.
//   * pause(id) clears the auto-dismiss timer; resume(id) re-arms with the
//     REMAINING time (not a fresh window).
//   * dismiss(id) removes immediately.

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.getState().clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('push adds a toast with monotonically increasing ids', () => {
    const a = pushToast('first', 'info');
    const b = pushToast('second', 'error');
    expect(b).toBeGreaterThan(a);
    expect(useToastStore.getState().toasts).toHaveLength(2);
    expect(useToastStore.getState().toasts[0].message).toBe('first');
    expect(useToastStore.getState().toasts[1].message).toBe('second');
  });

  it('auto-dismisses success toasts at AUTO_DISMISS_MS (6 sec)', () => {
    pushToast('saved', 'success');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-dismisses error toasts at AUTO_DISMISS_MS (fix-86 change — used to be sticky)', () => {
    pushToast('boom', 'error');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(AUTO_DISMISS_MS + 100);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('dismiss removes only the matching toast', () => {
    const a = pushToast('a', 'error');
    pushToast('b', 'error');
    useToastStore.getState().dismiss(a);
    const remaining = useToastStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe('b');
  });

  it('pause holds the toast indefinitely; resume re-arms with the remaining time', () => {
    const id = pushToast('hover me', 'info');
    // Consume 3 sec of the 6 sec budget.
    vi.advanceTimersByTime(3_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    useToastStore.getState().pause(id);
    // Hover for far longer than the original budget — paused toast persists.
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    useToastStore.getState().resume(id);
    // Only 3 sec remain (6 sec budget - 3 sec already consumed). At
    // 2999ms post-resume the toast should still be visible…
    vi.advanceTimersByTime(2_999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    // …and one tick later it auto-dismisses.
    vi.advanceTimersByTime(2);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('pause+resume on an already-dismissed toast is a no-op (no crash)', () => {
    const id = pushToast('gone', 'info');
    useToastStore.getState().dismiss(id);
    expect(() => useToastStore.getState().pause(id)).not.toThrow();
    expect(() => useToastStore.getState().resume(id)).not.toThrow();
  });

  it('dismiss after pause cleans the paused-timer entry (no zombie re-arm)', () => {
    const id = pushToast('paused then dismissed', 'info');
    useToastStore.getState().pause(id);
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    // A late resume on a fully-dismissed toast must not resurrect it.
    useToastStore.getState().resume(id);
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 2);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('clear removes everything and cancels pending timers', () => {
    pushToast('a', 'info');
    pushToast('b', 'success');
    useToastStore.getState().clear();
    expect(useToastStore.getState().toasts).toHaveLength(0);
    // No zombie re-fires from the timers that were pending at clear().
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 2);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
