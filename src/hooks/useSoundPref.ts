import { useCallback, useSyncExternalStore } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  DEFAULT_SOUND_PREF,
  loadSoundPref,
  saveSoundPref,
  type SoundPref,
} from '../lib/desktopAlerts';

// ===========================================================================
// ★ fix-369 — the sound preference, shared between two places
// ===========================================================================
//
// ★★ WHY THIS IS NOT THE fix-365 BOARD-LENS IDIOM, exactly.
//
// A board lens is read and written by the same component tree, so `useState`
// over `localStorage` is enough — the writer re-renders the reader. This
// preference is SET on /notifications and READ by the shell's alert driver,
// which is a different subtree that never re-renders when the other one does.
// Storage alone would leave the driver on a stale value until a reload.
//
// ★ So: the same localStorage key and the same per-user shape, plus the
// smallest possible notification of change. `useSyncExternalStore` is React's
// own answer to exactly this and needs no store, no context and no provider —
// and its snapshot here is a string, so there is no object identity to get
// wrong.

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export interface SoundPrefState {
  pref: SoundPref;
  setPref: (next: SoundPref) => void;
}

export function useSoundPref(): SoundPrefState {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const snapshot = useCallback(
    () => loadSoundPref(userId) ?? DEFAULT_SOUND_PREF,
    [userId],
  );

  // ★ The third argument is the server snapshot. Identical here because the
  // preference is a client fact — there is no server rendering of it to match.
  const pref = useSyncExternalStore(subscribe, snapshot, snapshot);

  const setPref = useCallback(
    (next: SoundPref) => {
      saveSoundPref(userId, next);
      for (const l of [...listeners]) l();
    },
    [userId],
  );

  return { pref, setPref };
}
