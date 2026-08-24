import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useToastStore } from '../stores/toastStore';

// ===========================================================================
// ★★★ fix-395 — THE CHASE SWEEP
// ===========================================================================
//
// ★★ useNumberEntrySweep's shape, deliberately, down to the storage-key naming
// and the silent-unless-something-happened toast. Read them side by side.
//
// ★★★ WHY A SWEEP AT ALL. Every other lifecycle task is minted by a CITY EVENT
// — corrections land, intake is accepted, the permit issues — so a trigger has
// a row to hang on. This one is minted by TIME PASSING. Nothing happens on day
// 7; that is precisely the problem the ticket exists to solve, and it is why
// fix-305's prompt was never acted on. So it takes the only shape the engine
// already has for time-based work: a daily sweep, guarded server-side by
// app_sweeps to once per tenant per day.
//
// ★ The localStorage guard is a courtesy on top, exactly as in the sibling — it
// avoids re-hitting the RPC on every Dashboard mount in the same browser on the
// same day. The server guard is the real one.

const SWEEP_STORAGE_KEY = 'mytasks.city-chase-sweep.lastRun';

/** Pure guard: should the sweep run, given the last-run date (YYYY-MM-DD)
 *  persisted client-side and today's date? Exported for tests. A second mount
 *  the same day is a no-op; a new day (or never-run) runs. */
export function shouldRunChaseSweep(
  lastRun: string | null | undefined,
  today: string,
): boolean {
  return lastRun !== today;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useCityChaseSweep() {
  const pushToast = useToastStore((s) => s.push);
  const queryClient = useQueryClient();

  useEffect(() => {
    const today = todayIso();
    let lastRun: string | null;
    try {
      lastRun = window.localStorage.getItem(SWEEP_STORAGE_KEY);
    } catch {
      lastRun = null;
    }
    if (!shouldRunChaseSweep(lastRun, today)) return;

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc(
        'bp_generate_city_chase_tasks',
        {},
      );
      if (cancelled) return;
      // Best-effort: a sweep failure must never break the Dashboard, and the
      // guard is not persisted on error so the next mount retries.
      if (error) return;
      try {
        window.localStorage.setItem(SWEEP_STORAGE_KEY, today);
      } catch {
        // localStorage unavailable — the server guard still prevents dupes.
      }
      const n = typeof data === 'number' ? data : 0;
      if (n > 0) {
        pushToast(
          `${n} permit${n === 1 ? '' : 's'} past the city's target — see My Tasks`,
          'info',
        );
        // ★ Bare prefix, covering allTasks / permitTaskTree / myTasks — the
        //   same invalidation the sibling sweep does. NOT a new notification
        //   path: a minted chase task reaches the bell the way every other bot
        //   task does, through fix-360's existing grouping.
        queryClient.invalidateQueries({ queryKey: ['permit_tasks'] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pushToast, queryClient]);
}
