import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useToastStore, pushToast } from '../stores/toastStore';

// Q3: toast store contract — push/dismiss, auto-dismiss for success/info,
// stick-around for warn/error.

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

  it('auto-dismisses success toasts after 4 seconds', () => {
    pushToast('saved', 'success');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(3_999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('keeps error toasts until manually dismissed', () => {
    pushToast('boom', 'error');
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('dismiss removes only the matching toast', () => {
    const a = pushToast('a', 'error');
    pushToast('b', 'error');
    useToastStore.getState().dismiss(a);
    const remaining = useToastStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe('b');
  });
});
