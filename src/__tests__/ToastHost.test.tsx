import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ToastHost from '../components/ToastHost';
import { useToastStore, pushToast, AUTO_DISMISS_MS } from '../stores/toastStore';

// fix-86: ToastHost wiring. Click dismisses; hover pauses; mouse-leave
// resumes. The click + hover behavior is what makes the auto-dismiss
// bearable — Bobby's 4563 34th Ave W backfill: error toasts piled up
// because he had nowhere to click to clear them.

describe('<ToastHost /> (fix-86 interactions)', () => {
  beforeEach(() => {
    useToastStore.getState().clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clicking a toast dismisses it immediately', () => {
    pushToast('saved', 'success');
    render(<ToastHost />);
    const toast = screen.getByTestId('toast-success');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    fireEvent.click(toast);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('hovering pauses auto-dismiss; mouse-leave resumes with remaining time', () => {
    pushToast('hover me', 'info');
    render(<ToastHost />);
    const toast = screen.getByTestId('toast-info');

    // Consume 3 sec of the 6 sec budget before the user hovers.
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    fireEvent.mouseEnter(toast);

    // Long hover — toast must persist.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);

    // Mouse leaves. Only 3 sec of budget remain.
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('renders a × close affordance for discoverability', () => {
    const id = pushToast('with close', 'warn');
    render(<ToastHost />);
    expect(screen.getByTestId(`toast-close-${id}`)).toBeInTheDocument();
  });

  it('left undisturbed, a toast auto-dismisses after AUTO_DISMISS_MS', () => {
    pushToast('byebye', 'success');
    render(<ToastHost />);
    expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS + 100);
    });
    expect(screen.queryByTestId('toast-success')).not.toBeInTheDocument();
  });
});
