import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TaskStatus, TaskWriteStatus } from './taskStatus';
import {
  NO_PENDING_STATUSES,
  TaskStatusOverlayContext,
  TaskStatusPendingContext,
  type OverlayApi,
  type PendingStatuses,
} from './taskStatusOverlayContext';

// ★★★ fix-434 — the provider, ALONE in this file.
//
// Everything else about the overlay (the contexts, the read hooks, the pure
// applier) lives in `taskStatusOverlayContext.ts`, and the split is not
// stylistic: eslint's `react-refresh/only-export-components` is an ERROR in
// this repo, and a file exporting both a component and a hook trips it. The
// header comment there is the one worth reading — it carries the measurement.

export function TaskStatusOverlayProvider({ children }: { children: ReactNode }) {
  // ★ The ref is read by handlers; the state exists to schedule a render.
  //   They are written together, never separately.
  const pending = useRef<Map<string, TaskWriteStatus>>(new Map());
  const [snapshot, setSnapshot] = useState<PendingStatuses>(NO_PENDING_STATUSES);

  // ★ The ONE place the ref is copied into state, so the two cannot drift.
  const publish = useCallback(() => {
    setSnapshot(new Map(pending.current));
  }, []);

  const set = useCallback(
    (taskId: string, status: TaskWriteStatus) => {
      pending.current.set(taskId, status);
      publish();
    },
    [publish],
  );

  const clear = useCallback(
    (taskId: string) => {
      if (!pending.current.delete(taskId)) return;
      publish();
    },
    [publish],
  );

  // ★★★ AGREEMENT, NOT A TIMER AND NOT MUTATION SUCCESS. Clearing an intent
  // when the write resolves would snap the row back to the still-stale cached
  // value for as long as the refetch takes — a visible flicker back to the old
  // status on every tick. The one moment the two cannot disagree is when the
  // refetched row already SAYS what the person said, so that is when it goes.
  //
  // ★ A task that has vanished from the list (deleted, or filtered out of the
  //   tenant) drops its intent too, so the map cannot grow without bound on a
  //   board somebody leaves open all day.
  const reconcile = useCallback(
    (rows: readonly { id: string; status: TaskStatus }[]) => {
      if (pending.current.size === 0) return;
      const byId = new Map(rows.map((r) => [r.id, r.status]));
      let changed = false;
      for (const [id, intent] of [...pending.current]) {
        const server = byId.get(id);
        if (server === undefined || server === intent) {
          pending.current.delete(id);
          changed = true;
        }
      }
      if (changed) publish();
    },
    [publish],
  );

  const readCurrent = useCallback(
    (taskId: string, serverStatus: TaskStatus): TaskStatus =>
      pending.current.get(taskId) ?? serverStatus,
    [],
  );

  const value = useMemo<OverlayApi>(
    () => ({
      readCurrent,
      set,
      clear,
      reconcile,
    }),
    // ★ Every member is a `useCallback` with no dependencies and every one of
    //   them reads the ref, so this object is created ONCE and never replaced.
    //   That is what keeps a click off every other card on the board.
    [readCurrent, set, clear, reconcile],
  );

  return (
    <TaskStatusOverlayContext.Provider value={value}>
      <TaskStatusPendingContext.Provider value={snapshot}>
        {children}
      </TaskStatusPendingContext.Provider>
    </TaskStatusOverlayContext.Provider>
  );
}

