import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PriorityStar from '../components/shared/PriorityStar';

// ===========================================================================
// ★★★ fix-484 §B (P-129) — THE PRIORITY STAR ON THE PERMIT SCREEN
// ===========================================================================
//
// The permit screen has SORTED by priority since fix-156 — priority tasks bubble
// to the top of every column — and has never had a control to set it. You could
// see the effect of a flag you could not reach.
//
// Ruled 2026-09-02: **mount the star; leave the order exactly as it is.**

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
/** Comment-stripped: the fix-411 trap, and §B's assertions are mostly
 *  "this file does X", which a comment saying X would satisfy. */
const code = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
    .join('\n');

const PERMIT = code(src('src/components/ProjectDetail/PermitDetailV2.tsx'));
const PERMIT_RAW = src('src/components/ProjectDetail/PermitDetailV2.tsx');
const EDITOR = code(src('src/components/TaskDetailEditor.tsx'));

// ---------------------------------------------------------------------------
// The control itself
// ---------------------------------------------------------------------------
describe('fix-484 §B: one star, two call sites', () => {
  it('★★★ it is EXTRACTED, not copied — both surfaces import the same file', () => {
    // ★★★ The rule the brief set, and the one this repo keeps re-learning:
    //     `chipStyle` was four copies before fix-441, the two-state toggle was
    //     three before fix-483. A second inline star is how the two start
    //     disagreeing about what "on" looks like.
    expect(EDITOR).toContain("from './shared/PriorityStar'");
    expect(PERMIT).toContain("from '../shared/PriorityStar'");
    // …and neither draws its own.
    expect(EDITOR).not.toContain("{task.priority ? '★' : '☆'}");
    expect(PERMIT).not.toContain("{task.priority ? '★' : '☆'}");
  });

  it('★★ it renders both states, with the ink and glyphs fix-138-a chose', () => {
    const { rerender } = render(
      <PriorityStar value={false} onChange={() => {}} testid="s" />,
    );
    const off = screen.getByTestId('s');
    expect(off.textContent).toBe('☆');
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(off.dataset.priority).toBe('false');
    expect(off.style.color).toBe('var(--color-muted)');
    expect(off.title).toBe('Priority off');

    rerender(<PriorityStar value onChange={() => {}} testid="s" />);
    const on = screen.getByTestId('s');
    expect(on.textContent).toBe('★');
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(on.style.color).toBe('var(--color-co)');
    expect(on.title).toBe('Priority on');
  });

  it('★★★ it TOGGLES — it emits the opposite of what it was given', () => {
    const seen: boolean[] = [];
    const { rerender } = render(
      <PriorityStar value={false} onChange={(v) => seen.push(v)} testid="s" />,
    );
    fireEvent.click(screen.getByTestId('s'));
    rerender(<PriorityStar value onChange={(v) => seen.push(v)} testid="s" />);
    fireEvent.click(screen.getByTestId('s'));
    expect(seen).toEqual([true, false]);
  });

  it('★★ null and undefined read as OFF, not as a third state', () => {
    // `bp_list_tasks` can hand back a null here; a star that rendered "maybe"
    // would be a state the column has no meaning for.
    for (const v of [null, undefined] as const) {
      const { unmount } = render(
        <PriorityStar value={v} onChange={() => {}} testid="s" />,
      );
      expect(screen.getByTestId('s').textContent).toBe('☆');
      unmount();
    }
  });

  it('★★ disabled says so before it is clicked, and emits nothing', () => {
    const seen: boolean[] = [];
    render(
      <PriorityStar value={false} onChange={(v) => seen.push(v)} disabled testid="s" />,
    );
    const el = screen.getByTestId('s') as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.style.cursor).toBe('default');
    fireEvent.click(el);
    expect(seen).toEqual([]);
  });

  it("★ the detail editor's testid is unchanged — every existing test still reaches it", () => {
    render(<PriorityStar value onChange={() => {}} />);
    expect(screen.getByTestId('task-detail-priority')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Where it is mounted, and what it writes
// ---------------------------------------------------------------------------
describe('fix-484 §B: the permit screen mounts it and writes one column', () => {
  it('★★★ the permit task row renders it, keyed per task', () => {
    expect(PERMIT).toContain('<PriorityStar');
    expect(PERMIT).toContain('testid={`task-priority-${task.id}`}');
    expect(PERMIT).toContain('onChange={(next) => save({ priority: next })}');
  });

  it('★★★ ONE COLUMN, NO SYNC — it writes `priority` through the same RPC', () => {
    // ★★ `permit_tasks.priority` is the flag My Tasks reads. Setting it here is
    //    setting it there because there is ONE ROW; nothing copies, nothing
    //    reconciles. That is why this ticket is a mount, not an integration.
    expect(PERMIT).toContain('priority: boolean;'); // the save() patch accepts it
    const tree = code(src('src/hooks/useTaskTree.ts'));
    expect(tree).toContain('p_priority: input.priority ?? null');
    // ★★★ AND `false ?? null` IS `false`, NOT null — so turning a star OFF
    //     really writes false rather than hitting the RPC's leave-unchanged arm.
    //     The whole feature would be one-way if this were `||`.
    expect(tree).not.toContain('p_priority: input.priority || null');
  });

  it('★★★ …and every OTHER save on the row leaves the flag alone', () => {
    // `save()` re-sends the whole row. It does not send `priority` unless the
    // star was clicked, and the live RPC reads
    //   priority = CASE WHEN p_priority IS NOT NULL THEN p_priority ELSE priority END
    // so a text edit or a status flip cannot clear a star somebody set.
    // Asserted structurally: `priority` appears in the patch TYPE and in the
    // star's onChange, and nowhere in the body `save()` always sends.
    // ★ Scoped to TaskItem's own `save()` — the file has other `upsert.mutate`
    //   calls (the add-task handler, the subtask composer) and slicing from the
    //   first one would assert about the wrong function.
    const fromSave = PERMIT.slice(PERMIT.indexOf('  function save('));
    const call = fromSave.slice(fromSave.indexOf('upsert.mutate({'));
    const body = call.slice(0, call.indexOf('});'));
    expect(body).toContain('sortOrder: task.sort_order');
    expect(body).toContain('...patch');
    expect(body).not.toContain('priority');
  });

  it('★★ it is inert on a cancelled task, like every other control on the row', () => {
    expect(PERMIT).toContain(
      'disabled={isTaskCancelled(task.status) || upsert.isPending}',
    );
  });
});

// ---------------------------------------------------------------------------
// The order is UNCHANGED, and the file says why
// ---------------------------------------------------------------------------
describe('fix-484 §B: the permit list does not band by date', () => {
  it('★★★ the sort is still priority-then-RPC-order, untouched', () => {
    // Ruled 2026-09-02: mount the star, leave the order exactly as it is.
    expect(PERMIT).toContain(
      '.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0))',
    );
    // ★ No date bucketing crept in with the control.
    const active = PERMIT.slice(PERMIT.indexOf('const active = tasks'));
    const upTo = active.slice(0, active.indexOf('const done ='));
    for (const band of ['Overdue', 'Today', 'This week', 'Later']) {
      expect(upTo, band).not.toContain(band);
    }
  });

  it('★★★ …and the REASON is written where the next person will look', () => {
    // ★★ The brief asked for this comment by name, and it is the load-bearing
    //    half: without it, "make it match My Tasks" is an obvious next ticket.
    //    The two lists answer different questions — "what is outstanding on
    //    this permit" is not "what should I do next".
    expect(PERMIT_RAW).toContain('what is outstanding on THIS');
    expect(PERMIT_RAW).toContain('what should I do next?');
    expect(PERMIT_RAW).toContain('fix-444');
  });
});
