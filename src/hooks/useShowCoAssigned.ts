import { useCallback, useSyncExternalStore } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  SHOW_CO_ASSIGNED_DEFAULT,
  readShowCoAssigned,
  subscribeShowCoAssigned,
  writeShowCoAssigned,
} from '../lib/coAssignedPref';

/**
 * ★★★ fix-445 — the "Co-assigned" switch (ruling 4 / P-047).
 *
 * fix-409's `useShowHeldWork` shape exactly, including its two hard-won
 * choices:
 *
 * ★ THE USER ID COMES FROM `useAuthStore`, not `useSelfScope` — that hook
 *   pulls the roster and projects queries and is wholesale-mocked across the
 *   suite, so depending on it here would make this a new way for unrelated
 *   tests to break.
 *
 * ★★ `useSyncExternalStore` rather than state + an effect: no initial value to
 *   settle, so no flinch frame (fix-313's lazy-read rule).
 */
export function useShowCoAssigned(): {
  showCoAssigned: boolean;
  setShowCoAssigned: (next: boolean) => void;
} {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const showCoAssigned = useSyncExternalStore(
    subscribeShowCoAssigned,
    () => readShowCoAssigned(userId),
    // ★ Server/prerender snapshot: the default. Unlike held work the default
    //   here is ON, so the no-session render shows everything rather than
    //   hiding four fifths of some people's board.
    () => SHOW_CO_ASSIGNED_DEFAULT,
  );
  const setShowCoAssigned = useCallback(
    (next: boolean) => writeShowCoAssigned(userId, next),
    [userId],
  );
  return { showCoAssigned, setShowCoAssigned };
}
