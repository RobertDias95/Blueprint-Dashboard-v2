import { useCallback, useSyncExternalStore } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  SHOW_HELD_WORK_DEFAULT,
  readShowHeldWork,
  subscribeShowHeldWork,
  writeShowHeldWork,
} from '../lib/heldWorkPref';

/**
 * ★★★ fix-409 — the one "show held work" switch, read by both screens.
 *
 * Bobby (register P-039): *"when you turn it on in my tasks or my board, it
 * will turn them on together — that way they live together in display."*
 *
 * ★ THE USER ID COMES FROM `useAuthStore`, which is how fix-403's own filter
 * callers (LibraryMatrix, Dashboard) key their per-user memory. Deliberately
 * NOT `useSelfScope` — that pulls the roster and projects queries, and it is
 * wholesale-mocked across the suite, so depending on it here would make this
 * hook a new way for unrelated tests to break.
 *
 * ★★ `useSyncExternalStore` rather than state + an effect: there is no initial
 * value to settle and therefore no flinch frame (fix-313's rule — a lazy read,
 * never an effect), and a write from the other screen reaches this one without
 * either of them knowing the other exists.
 */
export function useShowHeldWork(): {
  showHeldWork: boolean;
  setShowHeldWork: (next: boolean) => void;
} {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const showHeldWork = useSyncExternalStore(
    subscribeShowHeldWork,
    () => readShowHeldWork(userId),
    // ★ Server/prerender snapshot: the default. There is no session there to
    //   read, and guessing "on" would render work the person did not ask for.
    () => SHOW_HELD_WORK_DEFAULT,
  );
  const setShowHeldWork = useCallback(
    (next: boolean) => writeShowHeldWork(userId, next),
    [userId],
  );
  return { showHeldWork, setShowHeldWork };
}
