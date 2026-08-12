import { describe, it, expect } from 'vitest';
import { countGrouped, nestSubtasks } from '../lib/taskNesting';

// fix-294: My Tasks rendered subtasks as separate top-level rows while Project
// Overview nested them under their parent — the same tasks reading as two
// different structures depending on the screen. The relationship was already in
// the data (permit_tasks.parent_task_id, returned by both bp_my_tasks and
// bp_list_tasks); nothing grouped by it. 98 subtasks across 74 parents in
// production.

interface T {
  id: string;
  parent_task_id?: string | null;
}
const t = (id: string, parent?: string): T => ({
  id,
  parent_task_id: parent ?? null,
});

describe('fix-294 nesting', () => {
  it('puts a subtask under its parent instead of beside it', () => {
    const groups = nestSubtasks([t('a'), t('a1', 'a'), t('b')]);
    expect(groups.map((g) => g.task.id)).toEqual(['a', 'b']);
    expect(groups[0].subtasks.map((s) => s.id)).toEqual(['a1']);
    expect(groups[1].subtasks).toEqual([]);
  });

  it('keeps several subtasks under one parent', () => {
    const groups = nestSubtasks([t('a'), t('a1', 'a'), t('a2', 'a'), t('a3', 'a')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].subtasks.map((s) => s.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('nests a subtask that appears BEFORE its parent in the list', () => {
    // The caller sorts by date or bucket, so a subtask can sort ahead of its
    // parent. It must still nest, not become a second top-level row.
    const groups = nestSubtasks([t('a1', 'a'), t('b'), t('a')]);
    expect(groups.map((g) => g.task.id)).toEqual(['b', 'a']);
    expect(groups[1].subtasks.map((s) => s.id)).toEqual(['a1']);
  });

  // ★ THE ONE THAT MATTERS MOST. My Tasks filters — by assignee, status,
  // project, title — so a subtask assigned to you whose PARENT belongs to
  // somebody else is routinely visible without its parent. Nesting it under a
  // parent that is not there would make it disappear from your own list, which
  // is worse than the bug being fixed.
  it('promotes an orphaned subtask to top level rather than dropping it', () => {
    const groups = nestSubtasks([t('a1', 'missing-parent'), t('b')]);
    expect(groups.map((g) => g.task.id)).toEqual(['a1', 'b']);
    expect(groups[0].subtasks).toEqual([]);
  });

  it('never loses a task, whatever the shape', () => {
    const input = [t('a'), t('a1', 'a'), t('orphan', 'gone'), t('b'), t('b1', 'b')];
    const groups = nestSubtasks(input);
    const seen = groups.flatMap((g) => [g.task.id, ...g.subtasks.map((s) => s.id)]);
    expect(seen.sort()).toEqual(['a', 'a1', 'b', 'b1', 'orphan']);
    expect(seen).toHaveLength(input.length);
  });

  it('preserves the caller\'s order — it groups, it does not sort', () => {
    // My Tasks offers two sorts; the choice belongs to the caller.
    const groups = nestSubtasks([t('z'), t('m'), t('a')]);
    expect(groups.map((g) => g.task.id)).toEqual(['z', 'm', 'a']);
  });

  it('handles an empty list and a list with no subtasks at all', () => {
    expect(nestSubtasks([])).toEqual([]);
    const flat = nestSubtasks([t('a'), t('b')]);
    expect(flat).toHaveLength(2);
    expect(flat.every((g) => g.subtasks.length === 0)).toBe(true);
  });

  it('treats undefined parent_task_id the same as null', () => {
    const groups = nestSubtasks([{ id: 'a' }, { id: 'b' }]);
    expect(groups).toHaveLength(2);
  });

  it('does not drop a grandchild if one ever appears', () => {
    // Subtasks are single-level in the UI, but a nested-deeper row must still
    // render somewhere rather than vanish.
    const groups = nestSubtasks([t('a'), t('a1', 'a'), t('a1x', 'a1')]);
    const seen = groups.flatMap((g) => [g.task.id, ...g.subtasks.map((s) => s.id)]);
    expect(seen).toContain('a1x');
    expect(seen).toHaveLength(3);
  });
});

describe('fix-294 countGrouped', () => {
  it('counts TASKS, not groups — the heading number must match the screen', () => {
    const groups = nestSubtasks([t('a'), t('a1', 'a'), t('a2', 'a'), t('b')]);
    expect(groups).toHaveLength(2);
    expect(countGrouped(groups)).toBe(4);
  });

  it('is zero for an empty list', () => {
    expect(countGrouped([])).toBe(0);
  });
});
