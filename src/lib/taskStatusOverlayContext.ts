import { createContext, useContext } from 'react';
import type { TaskStatus, TaskWriteStatus } from './taskStatus';

// ===========================================================================
// ★★★ fix-434 §B — what the row says BEFORE the server has answered
// (the contexts, the read hooks and the pure applier; the PROVIDER is the
//  sibling .tsx, because eslint's react-refresh rule will not have a file that
//  exports both a component and anything else)
// ===========================================================================
//
// MEASURED FIRST (the brief's rule, and the reason this file has the shape it
// has). Ten rapid clicks on the checkbox of one row, board of 200 tasks, before
// anything was changed:
//
//     bp_upsert_permit_task calls          10
//     …every one of them sending    'In Progress'
//     bp_list_tasks refetches              10   (1,643 rows / ~1.1 MB each)
//     TaskCard re-renders across the burst  1
//     final state                   'In Progress'   ← NOT Resolved
//
// ★★★ SO IT IS TWO OF THE THREE CANDIDATE CAUSES, AND THE THIRD IS RULED OUT.
// The re-render count is 1 — react-query's structural sharing means ten
// identical refetches produce a referentially equal array and the board does
// not re-render at all. Memoising the row would have fixed nothing.
//
//   · CAUSE 1 (the round trip): there was no optimistic update, so the row
//     could not move until a full refetch landed. Every one of the ten
//     handlers therefore read the SAME stale `task.status`, computed the same
//     Open → In Progress transition, and the queue-clearer's three fast clicks
//     landed on In Progress instead of Resolved. That is B2's race, and it is
//     not a race between writes — it is ten reads of a value that could not
//     move.
//   · CAUSE 2 (the refetch): each write invalidated the whole `permit_tasks`
//     prefix, and `bp_list_tasks` returns EVERY task in the tenant as one
//     jsonb aggregate — 1,643 objects, ~1.1 MB, no pagination. Ten clicks meant
//     ~11 MB of JSON parsed on the main thread. That is the freeze Miles saw.
//
// ★★★ IT LIVES IN lib/, NOT components/MyTasks/, BECAUSE `useUpsertTask` READS
// IT. The rollback cannot be a per-call `mutate(input, { onError })`: an
// optimistic tick MOVES the row to another sub-column, which unmounts the card,
// and React Query drops a mutation's per-call callbacks when the component that
// called `mutate` unmounts. Measured — the toast fired, the correcting refetch
// landed, and the row still read "Resolved". So the clear belongs in the
// mutation's OWN onError, which means the generic task hook has to be able to
// reach this, and a hook reaching into a page's component folder is the wrong
// direction.
//
// ★★★ THIS FILE FIXES CAUSE 1, AND IT IS A CONTEXT, NOT A MODULE GLOBAL.
// A `Map` at module scope would read synchronously (which is the requirement —
// see below) but would survive between test files and between two mounts of
// the board, so a task ticked in one test would arrive already ticked in the
// next. Held in a provider, the overlay lives exactly as long as the board
// does.
//
// ★★★ THE REF IS THE POINT, NOT AN OPTIMISATION. Ten `fireEvent.click`s inside
// one React batch produce ZERO re-renders between them, so a handler that read
// its current status from props — or from `useState` — would read the same
// stale value ten times over however fast the state updated. `readCurrent`
// reads a ref, which is written synchronously inside the click handler, so
// click 2 sees what click 1 decided. The `useState` beside it exists only to
// PUBLISH that ref as an immutable snapshot for rendering.

/** What the person has said, not yet acknowledged by the server. */
export type PendingStatuses = ReadonlyMap<string, TaskWriteStatus>;

export const NO_PENDING_STATUSES: PendingStatuses = new Map();

export interface OverlayApi {
  /** ★ The SYNCHRONOUS read, for a click handler deciding the next
   *  transition. Reads the ref, so it is correct inside a batch. */
  readCurrent: (taskId: string, serverStatus: TaskStatus) => TaskStatus;
  /** Record what the person just said. */
  set: (taskId: string, status: TaskWriteStatus) => void;
  /** ★ B3: drop the intent so the row snaps back to what the server holds. */
  clear: (taskId: string) => void;
  /** ★★ Drop every intent the freshly-loaded server rows already agree with,
   *  plus any whose task has gone. Call from an EFFECT, never during render —
   *  the React Compiler rejects a mutation in a render body and only lint
   *  catches it. */
  reconcile: (rows: readonly { id: string; status: TaskStatus }[]) => void;
}

export const NOOP_OVERLAY: OverlayApi = {
  readCurrent: (_id, s) => s,
  set: () => {},
  clear: () => {},
  reconcile: () => {},
};

// ★★★ TWO CONTEXTS, AND THAT SPLIT IS LOAD-BEARING.
//
// A context whose value changes re-renders EVERY consumer, memo or no memo. If
// the pending map travelled with the actions, every card on the board would
// re-render on every click even though only one row's status moved — which is
// the very cost this ticket is removing. So the ACTIONS are stable for the life
// of the provider (they close over a ref, never over state), and the SNAPSHOT
// is its own context consumed by exactly one component: the body that
// re-derives the task array. Cards subscribe only to the actions and therefore
// re-render only when their own `task` prop changes.
export const TaskStatusOverlayContext = createContext<OverlayApi>(NOOP_OVERLAY);
export const TaskStatusPendingContext =
  createContext<PendingStatuses>(NO_PENDING_STATUSES);

/** ★ Outside a provider this is inert and the row reads the server value —
 *  which is exactly the pre-fix-434 behaviour, so any surface that has not
 *  opted in keeps working unchanged. */
export function useTaskStatusOverlay(): OverlayApi {
  return useContext(TaskStatusOverlayContext);
}

/** ★ Subscribe to "something was ticked". Only the component that maps over the
 *  task array needs this — see the note above the two contexts.
 *
 *  ★★ It hands back the MAP rather than a version counter, and that is what
 *  keeps the memo downstream honest: a counter would be a dependency the
 *  computation never reads, which lint calls out as unnecessary and which is a
 *  fair thing to call out. A new Map identity per change says the same thing
 *  and is the thing actually consumed. */
export function useTaskStatusPending(): PendingStatuses {
  return useContext(TaskStatusPendingContext);
}

/**
 * ★★ Apply the overlay to a list of tasks.
 *
 * Returning the same object when nothing is pending matters: `MineTasks` feeds
 * this array into a chain of `useMemo`s and every column and counter below it,
 * so an unnecessary new reference would re-render the board on every keystroke
 * elsewhere.
 *
 * ★ Dropping stale intents is `reconcile`'s job, from an effect. This function
 * is pure and safe to call during render.
 */
export function applyStatusOverlay<T extends { id: string; status: TaskStatus }>(
  tasks: T[],
  pending: PendingStatuses,
): T[] {
  if (pending.size === 0) return tasks;
  let changed = false;
  const out = tasks.map((t) => {
    const status = pending.get(t.id) ?? t.status;
    if (status === t.status) return t;
    changed = true;
    return { ...t, status };
  });
  return changed ? out : tasks;
}
