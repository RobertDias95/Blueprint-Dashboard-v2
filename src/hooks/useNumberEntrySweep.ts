import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useToastStore } from '../stores/toastStore';

// fix-155: client trigger for the numberless-permit sweep (Phase B). On
// Dashboard mount we fire bp_generate_number_entry_tasks, which self-guards to
// once per tenant per day server-side (via app_sweeps). This client-side
// localStorage guard is a courtesy on top — it avoids re-hitting the RPC on
// every Dashboard mount within the same day in the same browser. The toast is
// silent unless tasks were actually created.

const SWEEP_STORAGE_KEY = 'mytasks.number-entry-sweep.lastRun';

/** Pure guard: should the sweep run, given the last-run date (YYYY-MM-DD)
 *  persisted client-side and today's date? Exported for tests. A second mount
 *  the same day is a no-op; a new day (or never-run) runs. */
export function shouldRunSweep(
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

export function useNumberEntrySweep() {
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
    if (!shouldRunSweep(lastRun, today)) return;

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc(
        'bp_generate_number_entry_tasks',
        {},
      );
      if (cancelled) return;
      // Best-effort: a sweep failure must never break the Dashboard, and we
      // don't persist the guard on error so the next mount retries.
      if (error) return;
      try {
        window.localStorage.setItem(SWEEP_STORAGE_KEY, today);
      } catch {
        // localStorage unavailable — the server guard still prevents dupes.
      }
      const n = typeof data === 'number' ? data : 0;
      if (n > 0) {
        pushToast(
          `${n} permit${n === 1 ? '' : 's'} awaiting numbers — see My Tasks`,
          'info',
        );
        // New auto-tasks landed — refresh any cached task lists (bare prefix
        // covers allTasks / permitTaskTree / myTasks).
        queryClient.invalidateQueries({ queryKey: ['permit_tasks'] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pushToast, queryClient]);
}
