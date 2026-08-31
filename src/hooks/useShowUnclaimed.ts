import { useCallback, useSyncExternalStore } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  SHOW_UNCLAIMED_DEFAULT,
  readShowUnclaimed,
  subscribeShowUnclaimed,
  writeShowUnclaimed,
} from '../lib/unclaimedPref';

/**
 * ★★★ fix-458 §B — the "Unclaimed" switch (P-106).
 *
 * fix-445's `useShowCoAssigned` shape exactly, including its two hard-won
 * choices:
 *
 * ★ THE USER ID COMES FROM `useAuthStore`, not `useSelfScope` — that hook pulls
 *   the roster and projects queries and is wholesale-mocked across the suite, so
 *   depending on it here would make this a new way for unrelated tests to break.
 *
 * ★★ `useSyncExternalStore` rather than state + an effect: no initial value to
 *   settle, so no flinch frame (fix-313's lazy-read rule).
 */
export function useShowUnclaimed(): {
  showUnclaimed: boolean;
  setShowUnclaimed: (next: boolean) => void;
} {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const showUnclaimed = useSyncExternalStore(
    subscribeShowUnclaimed,
    () => readShowUnclaimed(userId),
    // ★ Server/prerender snapshot: the default, which is OFF — this switch
    //   REPLACES the board with a queue rather than narrowing it.
    () => SHOW_UNCLAIMED_DEFAULT,
  );
  const setShowUnclaimed = useCallback(
    (next: boolean) => writeShowUnclaimed(userId, next),
    [userId],
  );
  return { showUnclaimed, setShowUnclaimed };
}
