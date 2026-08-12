// fix-294: group a FLAT task list into parents with their subtasks beneath.
//
// Project Overview already renders subtasks nested inside their parent's card
// (PermitDetailV2's TaskItem takes an `isSubtask` prop). My Tasks rendered the
// same rows FLAT, so a subtask appeared as its own top-level row with no
// indication of what it belonged to — the same tasks reading as two different
// structures depending on which screen you were on.
//
// The relationship already existed in the data: permit_tasks.parent_task_id,
// and both bp_my_tasks and bp_list_tasks already return it. 98 subtasks across
// 74 parents in production. So this is grouping, not a schema or RPC change.
//
// ★ WHY THE OVERVIEW CANNOT JUST SHARE ITS CODE. bp_list_permit_tasks returns a
// NESTED shape (each task carries a `subtasks` array) because it reads one
// permit. My Tasks reads across every permit and gets a FLAT list, so the
// nesting has to happen client-side — and it has to survive filtering, which
// the per-permit tree never has to do.

/** A parent and the subtasks that belong to it, in display order. */
export interface TaskGroup<T> {
  task: T;
  subtasks: T[];
}

interface Nestable {
  id: string;
  parent_task_id?: string | null;
}

/**
 * Group a flat, ALREADY-SORTED list into parents + their subtasks.
 *
 * Order is preserved exactly: parents keep the caller's sort, and each parent's
 * subtasks keep theirs. This function does not sort, because My Tasks offers
 * two sorts and the choice belongs to the caller.
 *
 * ★ AN ORPHANED SUBTASK IS PROMOTED, NEVER DROPPED. My Tasks filters — by
 * assignee, status, project, title — so a subtask assigned to you whose PARENT
 * is assigned to somebody else is routinely in the visible set without its
 * parent. Nesting it under a parent that isn't there would make it vanish from
 * your own list, which is worse than the bug being fixed. It renders as a
 * top-level row instead, exactly as it does today.
 */
export function nestSubtasks<T extends Nestable>(
  tasks: readonly T[],
): TaskGroup<T>[] {
  const present = new Set(tasks.map((t) => t.id));
  const groups: TaskGroup<T>[] = [];
  const byParentId = new Map<string, TaskGroup<T>>();

  // Pass 1 — every row that will render as a top-level card, in order. A
  // subtask whose parent is absent from THIS list counts as top-level.
  for (const t of tasks) {
    const parentId = t.parent_task_id ?? null;
    if (parentId && present.has(parentId)) continue;
    const group: TaskGroup<T> = { task: t, subtasks: [] };
    groups.push(group);
    byParentId.set(t.id, group);
  }

  // Pass 2 — attach the rest. Guaranteed to find a home: the only rows skipped
  // above are those whose parent is present, and every present row that is not
  // itself nested got a group in pass 1.
  for (const t of tasks) {
    const parentId = t.parent_task_id ?? null;
    if (!parentId || !present.has(parentId)) continue;
    // A parent that is ITSELF a subtask (not a shape the UI creates — subtasks
    // are single-level — but cheap to be safe about) has no group of its own;
    // promoting the child keeps it visible rather than silently dropping it.
    const group = byParentId.get(parentId);
    if (group) group.subtasks.push(t);
    else groups.push({ task: t, subtasks: [] });
  }

  return groups;
}

/** Total rows a grouped list will render — parents plus their subtasks.
 *  Used for the counts beside section headings, which must keep counting
 *  TASKS rather than groups or the number stops matching what is on screen. */
export function countGrouped<T extends Nestable>(
  groups: readonly TaskGroup<T>[],
): number {
  return groups.reduce((n, g) => n + 1 + g.subtasks.length, 0);
}
