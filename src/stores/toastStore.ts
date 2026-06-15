import { create } from 'zustand';
import { logError } from '../lib/errorLogger';

// Q3 / fix-86: toast store. Match v1's bpToast contract (msg + kind) so call
// sites read identically across both codebases.
//
// fix-86: every toast auto-dismisses after AUTO_DISMISS_MS (6 sec — Bobby's
// 4563 34th Ave W backfill: error toasts stuck around forever and he had
// to refresh to clear them). Hover pauses the timer so toasts you're
// actively reading don't disappear mid-sentence; mouse-leave resumes from
// the REMAINING time, not a fresh 6 sec. Click anywhere on the toast
// dismisses it instantly. All visible in ToastHost.
//
// fix-87: every error toast ALSO fires a fire-and-forget log to
// bp_log_error so Settings → Errors collects the same information Bobby
// would otherwise have to remember + describe out-loud. The log call is
// async, never blocks the toast itself, and survives even if the RPC
// fails (the logger swallows its own errors so a network blip can't
// break the app's UX). Independent of the dismiss timer — every error
// toast goes to BOTH paths regardless of how the user dismisses it.

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

/** fix-165: per-toast options. `log` (default true) controls whether an
 *  error toast ALSO writes to error_reports via bp_log_error. Callers
 *  surfacing a user-input validation rejection (e.g. a chronology date error)
 *  pass `{ log: false }` so the user still sees the toast but the noise stays
 *  out of Error Reports. */
export interface ToastOptions {
  log?: boolean;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
  /** fix-86: hover-pause. Clears the auto-dismiss timer and records how much
   * time is left so resume() can re-arm with the same budget. */
  pause: (id: number) => void;
  /** fix-86: mouse-leave resume. Re-arms the auto-dismiss timer with the
   * REMAINING ms captured at pause time, so a brief hover doesn't grant
   * a fresh 6 sec. */
  resume: (id: number) => void;
  clear: () => void;
}

let nextId = 1;
export const AUTO_DISMISS_MS = 6_000;

/** Per-toast timer bookkeeping. Two shapes: armed (handle + expiresAt for
 * computing remaining on pause) or paused (just remainingMs). Lives outside
 * the store so React renders don't see it; the store only tracks toasts. */
type TimerEntry =
  | { state: 'armed'; handle: ReturnType<typeof setTimeout>; expiresAt: number }
  | { state: 'paused'; remainingMs: number };

const timers = new Map<number, TimerEntry>();

function clearTimerFor(id: number) {
  const entry = timers.get(id);
  if (entry?.state === 'armed') clearTimeout(entry.handle);
  timers.delete(id);
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, kind = 'info', opts) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    // fix-86: schedule auto-dismiss for ALL kinds (errors too — the original
    // "stay until manually dismissed" behavior caused the 4563 34th Ave W
    // pile-up). The timer Map drives pause/resume + cleanup on dismiss.
    const handle = setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
    timers.set(id, {
      state: 'armed',
      handle,
      expiresAt: Date.now() + AUTO_DISMISS_MS,
    });
    // fix-87: error toasts ALSO flow to the server error log. We pull
    // the URL from window.location lazily here (not at module-import
    // time) so vitest's jsdom URL is correct + we don't pin the SSR
    // path. Fire-and-forget; logError swallows its own failures so a
    // bad log call can't break the toast UX or trigger recursive logs
    // via the QueryClient global onError.
    // fix-165: `{ log: false }` shows the error toast but suppresses the
    // server log — used for user-input validation rejections (chronology
    // date errors) that are noise in Error Reports. Defaults to true so
    // every other error toast keeps logging exactly as before.
    if (
      kind === 'error' &&
      (opts?.log ?? true) &&
      typeof window !== 'undefined'
    ) {
      void logError({
        source: 'frontend_toast',
        level: 'error',
        message,
        context: { url: window.location?.pathname ?? '' },
      });
    }
    return id;
  },
  dismiss: (id) => {
    clearTimerFor(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  pause: (id) => {
    const entry = timers.get(id);
    if (!entry || entry.state !== 'armed') return;
    clearTimeout(entry.handle);
    const remainingMs = Math.max(0, entry.expiresAt - Date.now());
    timers.set(id, { state: 'paused', remainingMs });
  },
  resume: (id) => {
    const entry = timers.get(id);
    if (!entry || entry.state !== 'paused') return;
    const { remainingMs } = entry;
    const handle = setTimeout(() => get().dismiss(id), remainingMs);
    timers.set(id, {
      state: 'armed',
      handle,
      expiresAt: Date.now() + remainingMs,
    });
  },
  clear: () => {
    for (const id of timers.keys()) clearTimerFor(id);
    set({ toasts: [] });
  },
}));

/** Convenience helper for non-React code (mutation onError handlers, etc.). */
export function pushToast(
  message: string,
  kind: ToastKind = 'info',
  opts?: ToastOptions,
) {
  return useToastStore.getState().push(message, kind, opts);
}
