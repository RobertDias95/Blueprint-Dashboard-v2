import { create } from 'zustand';

// ===========================================================================
// fix-336 §1 — is the socket alive, and does anyone know?
// ===========================================================================
//
// ★★ THE BUG THIS EXISTS TO MAKE IMPOSSIBLE. `useRealtimeInvalidation` has
// called `channel.subscribe()` with NO callback since Q2, so the one place
// Supabase reports CHANNEL_ERROR / TIMED_OUT / CLOSED was thrown away. A
// subscription that never attaches looks exactly like a quiet afternoon, and
// the brief's rule is that "a dead socket that looks alive is the bug this
// ticket is fixing, reintroduced".
//
// ★ SO THE STATUS IS STATE, not a console line. The hook writes it, the bell
// and the notification centre read it, and when it is not SUBSCRIBED the app
// says so and falls back to polling instead of sitting silently on a dead wire.

/** The subscribe() lifecycle, plus the state before the first attempt. */
export type RealtimeStatus =
  | 'CONNECTING'
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED';

interface RealtimeState {
  status: RealtimeStatus;
  /** When the last postgres_changes payload arrived (epoch ms), or null. */
  lastEventAt: number | null;
  /** Set the moment the channel reports something other than SUBSCRIBED. */
  setStatus: (status: RealtimeStatus) => void;
  noteEvent: (at: number) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  status: 'CONNECTING',
  lastEventAt: null,
  setStatus: (status) => set({ status }),
  noteEvent: (at) => set({ lastEventAt: at }),
}));

/** ★ Is the live path working? Everything that is not SUBSCRIBED is degraded —
 *  including CONNECTING, because "we have not managed to attach yet" and "we
 *  attached and it broke" are the same thing to somebody waiting for a
 *  notification. The fallback poll is cheap; a wrong "live" is not. */
export function isRealtimeDegraded(status: RealtimeStatus): boolean {
  return status !== 'SUBSCRIBED';
}

/** The words the UI uses for it. One definition, so the bell and the centre
 *  cannot describe the same socket differently. */
export function realtimeStatusLabel(status: RealtimeStatus): string {
  switch (status) {
    case 'SUBSCRIBED':
      return 'Live';
    case 'CONNECTING':
      return 'Connecting — refreshing on a timer';
    case 'TIMED_OUT':
    case 'CHANNEL_ERROR':
    case 'CLOSED':
      return 'Offline — refreshing every 60s';
  }
}
