import {
  loadCollapsedKeys,
  saveCollapsedKeys,
  toggleCollapsedKey,
} from './collapsePrefs';

// fix-326: which panels of /board this person has folded.
//
// ★ NOT A THIRD PREFERENCE STORE — the brief was explicit. The reading and
// writing are `collapsePrefs`, the same mechanism fix-324b gave the Pipeline
// columns; this file only owns the namespace and the keys, exactly as
// `pipelinePrefs` does. Same shape, same guarantees, its own drawer.
//
// ★ WHY ITS OWN NAMESPACE rather than a key inside the Pipeline's list: a board
// preference filed under "pipeline.collapsed" is the misfiling nobody ever finds
// again, and the two screens have no reason to share a lifetime.

const NAMESPACE = 'board.collapsed';

/** The one panel that folds today. A string rather than a boolean so a second
 *  foldable region costs a new key and no new storage. */
export const BOARD_TASKS_KEY = 'my-tasks';

/**
 * ★ COLLAPSED IS THE DEFAULT. Bobby: "the primary focus should be the my board,
 * and then the my task should be expandable and collapsible … my task is
 * something they could dive into if and need be."
 *
 * ★ It is a DEFAULT, NOT A FLOOR — the fix-324b rule, restated because it is the
 * half that is easy to get wrong. It applies only while this person has never
 * chosen; the moment they expand My Tasks, their stored list is the whole answer
 * and this is never consulted again. A default that reasserted itself on every
 * load would be a preference that does not work.
 */
export function defaultBoardCollapsed(): string[] {
  return [BOARD_TASKS_KEY];
}

export function loadBoardCollapsed(
  userId: string | null | undefined,
): string[] | null {
  return loadCollapsedKeys(NAMESPACE, userId);
}

export function saveBoardCollapsed(
  userId: string | null | undefined,
  keys: string[],
): void {
  saveCollapsedKeys(NAMESPACE, userId, keys);
}

export { toggleCollapsedKey };
