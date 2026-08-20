import { describe, it, expect, beforeEach } from 'vitest';
import {
  associateOf,
  focusItems,
  groupItems,
  loadBoardLens,
  saveBoardLens,
  reconcileLens,
  DEFAULT_BOARD_LENS,
  OWN_WORK_LABEL,
} from '../lib/boardByAssociate';
import type { ForecastItem } from '../lib/myBoard';

// ===========================================================================
// fix-365 — a design manager cannot see whose work is whose
// ===========================================================================
//
// Bobby: "From the design manager perspective, being able to sort all the tasks
// by their design associates might be a very functional and helpful feature…
// versus having it be jumbled."
//
// ★★ fix-346 already put the work in front of them — a DM is auto-co-assigned
// to their associates' tasks. The board CONTAINS the work; it arrives as one
// undifferentiated list.
//
// ★★★ MEASURED on prod 2026-08-20, and the scale shaped the answer:
//
//     Brittani   Marc · Ahmadi · Fisk           20 open tasks
//     Lindsay    Francesca · Ainsley · Trevor   12
//     Derry      Nicky · Qisheng                11
//     Jade       Erick                           9
//
// Nine to twenty rows. A "whose is whose" problem, not a data-volume one.

/** Brittani's real shape. */
const BRITTANI = ['Marc', 'Ahmadi', 'Fisk'];

function item(over: Partial<ForecastItem> = {}): ForecastItem {
  return {
    key: 'k1',
    source: 'task',
    verb: 'Send corrections',
    why: '',
    where: '3626 164th Pl SE · Building Permit',
    date: '2026-08-18',
    daysLate: 2,
    bucket: 'past_due',
    actionable: true,
    permitId: 100,
    taskId: 't1',
    action: 'resolve-task',
    milestoneKind: null,
    anchor: null,
    task: null,
    cycleIndex: null,
    entLead: null,
    stateLabel: 'Past due',
    whyYours: '',
    actionLine: '',
    projectId: 'p1',
    address: '3626 164th Pl SE',
    permitLabel: 'Building Permit',
    withWhom: null,
    handedOff: false,
    ...over,
  } as ForecastItem;
}

/** A task row, whose associate is its own assignee (fix-346 leaves the primary
 *  alone and adds the MANAGER as a co-assignee). */
function taskFor(who: string, over: Partial<ForecastItem> = {}): ForecastItem {
  return item({
    key: `task-${who}-${over.key ?? '1'}`,
    source: 'task',
    task: { id: `t-${who}`, assigned_to: who } as never,
    ...over,
  });
}

/** A milestone row — no assignee at all; its associate is the PERMIT's da. */
function milestoneFor(permitId: number, over: Partial<ForecastItem> = {}): ForecastItem {
  return item({
    key: `ms-${permitId}-${over.key ?? '1'}`,
    source: 'milestone',
    task: null,
    taskId: null,
    permitId,
    action: 'ack',
    ...over,
  });
}

/** permit 100 → Marc, permit 200 → Ahmadi, permit 900 → somebody else's DA. */
const daOf = (permitId: number | null): string | null =>
  permitId === 100 ? 'Marc' : permitId === 200 ? 'Ahmadi' : permitId === 900 ? 'Cam' : null;

// ---------------------------------------------------------------------------
// §1 — group, and focus
// ---------------------------------------------------------------------------

describe('fix-365 §1: a manager with three associates sees the split', () => {
  it('★★★ three associates, three groups — from Brittani\'s real shape', () => {
    const rows = [
      taskFor('Marc'),
      taskFor('Ahmadi'),
      taskFor('Fisk'),
      taskFor('Marc', { key: '2' }),
    ];
    const groups = groupItems(rows, BRITTANI, daOf);
    expect(groups.map((g) => g.label)).toEqual(['Marc', 'Ahmadi', 'Fisk']);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 1]);
    // ★ Groups come out in the ROSTER's order (dm_da_groups.da_order), not in
    // the order rows happen to arrive — the same order the Draw Schedule shows.
    expect(groups[0].associate).toBe('Marc');
  });

  it('★★ a milestone row is grouped by the PERMIT\'s associate', () => {
    // A milestone has no assignee; the design associate is the permit's `da`.
    const groups = groupItems(
      [milestoneFor(100), milestoneFor(200)],
      BRITTANI,
      daOf,
    );
    expect(groups.map((g) => g.label)).toEqual(['Marc', 'Ahmadi']);
  });

  it('★★ the manager\'s OWN rows are kept, last, and named', () => {
    // A manager's own work does not stop existing because they asked to see
    // the split — and it is not silently mixed into an associate's pile.
    const groups = groupItems(
      [taskFor('Marc'), taskFor('Brittani'), milestoneFor(900)],
      BRITTANI,
      daOf,
    );
    expect(groups.map((g) => g.label)).toEqual(['Marc', OWN_WORK_LABEL]);
    expect(groups[1].items).toHaveLength(2);
    expect(groups[1].associate).toBeNull();
  });

  it('★ an associate with nothing in THIS bucket gets no empty heading', () => {
    // Measured: three of the eleven mapped associates have zero open tasks
    // (Fisk, Francesca, Qisheng). A fixed heading per associate would print
    // empty sections on every bucket of every board.
    const groups = groupItems([taskFor('Marc')], BRITTANI, daOf);
    expect(groups.map((g) => g.label)).toEqual(['Marc']);
  });

  it('★ focusing one associate shows only their work, and clearing restores it', () => {
    const rows = [taskFor('Marc'), taskFor('Ahmadi'), taskFor('Brittani')];
    expect(focusItems(rows, 'Ahmadi', BRITTANI, daOf)).toHaveLength(1);
    expect(focusItems(rows, 'Ahmadi', BRITTANI, daOf)[0].task?.assigned_to).toBe(
      'Ahmadi',
    );
    // ★ Clearing is the same code path with a null focus, so "restores
    // everything" is true by construction rather than by a second branch.
    expect(focusItems(rows, null, BRITTANI, daOf)).toHaveLength(3);
  });

  it('★ focus matches case-insensitively, like every other name match here', () => {
    expect(focusItems([taskFor('Marc')], 'marc', BRITTANI, daOf)).toHaveLength(1);
  });

  it('★★ the task\'s own assignee wins over the permit\'s DA', () => {
    // A permit assigned to Marc can carry a task somebody else is doing, and
    // the task's assignee is a direct statement about who is doing the work.
    const row = taskFor('Ahmadi', { permitId: 100 }); // permit 100's da is Marc
    expect(associateOf(row, BRITTANI, daOf)).toBe('Ahmadi');

    // ★★★ AND THE CASE THAT CAUGHT ME while writing this. A task assigned to
    // the MANAGER, sitting on an associate's permit, must NOT be filed under
    // the associate: it is the manager's own work on somebody else's project,
    // and a fall-through to the permit's DA would have put it in that person's
    // 1:1. An inference must not overrule a statement.
    const mine = taskFor('Brittani', { permitId: 100 });
    expect(associateOf(mine, BRITTANI, daOf)).toBeNull();

    // ★ Only a row with NO assignee at all — a milestone — asks the permit.
    expect(associateOf(milestoneFor(100), BRITTANI, daOf)).toBe('Marc');
  });
});

// ---------------------------------------------------------------------------
// ★★★ §2 — urgency stays outermost
// ---------------------------------------------------------------------------

describe('fix-365 §2: person groups INSIDE the buckets, never above them', () => {
  it('★★★ a past-due row is still past-due when grouped', () => {
    // The fix-348 contract, and the one most at risk. Grouping must not touch
    // the fields that say "this is late" — the board's whole job is surfacing
    // what is.
    const late = taskFor('Marc', { daysLate: 6, bucket: 'past_due', stateLabel: 'Past due' });
    const [group] = groupItems([late], BRITTANI, daOf);
    const [row] = group.items;
    expect(row.bucket).toBe('past_due');
    expect(row.daysLate).toBe(6);
    expect(row.stateLabel).toBe('Past due');
    // ★ …and it is the SAME OBJECT, not a copy that could drift.
    expect(row).toBe(late);
  });

  it('★★★ grouping cannot move a row between buckets — it never sees across them', () => {
    // The axis decision is enforced by the SHAPE of the function: it takes one
    // bucket's rows and returns that bucket's rows. Person outermost would bury
    // an overdue item under a name.
    const pastDue = [taskFor('Marc', { key: 'a', bucket: 'past_due' })];
    const nextWeek = [taskFor('Marc', { key: 'b', bucket: 'next_week' })];
    const g1 = groupItems(pastDue, BRITTANI, daOf);
    const g2 = groupItems(nextWeek, BRITTANI, daOf);
    expect(g1.flatMap((g) => g.items).every((i) => i.bucket === 'past_due')).toBe(true);
    expect(g2.flatMap((g) => g.items).every((i) => i.bucket === 'next_week')).toBe(true);
  });

  it('★ row order inside a group is the order the bucket gave it', () => {
    // The bucket is already date-sorted; grouping must not resort within it.
    const rows = [
      taskFor('Marc', { key: 'a', date: '2026-08-10' }),
      taskFor('Marc', { key: 'b', date: '2026-08-12' }),
      taskFor('Marc', { key: 'c', date: '2026-08-14' }),
    ];
    const [g] = groupItems(rows, BRITTANI, daOf);
    expect(g.items.map((i) => i.date)).toEqual([
      '2026-08-10',
      '2026-08-12',
      '2026-08-14',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ★★★ §4 — the associates nobody manages
// ---------------------------------------------------------------------------

describe('fix-365 §4: unmapped work is not silently swallowed', () => {
  it('★★★ Cam\'s row lands in "your own work", never in an associate\'s pile', () => {
    // MEASURED: Cam and Shire are active design associates with NO row in
    // dm_da_groups, holding 21 open tasks between them — more than Brittani's
    // whole book of three (20). Their work reaches no manager through fix-346's
    // co-assign and therefore none through this either.
    //
    // ★ If such a row ever DOES reach a manager's board, grouping must not
    // quietly file it under somebody. It is visibly not one of your
    // associates' — which is the honest statement.
    const groups = groupItems(
      [taskFor('Marc'), taskFor('Cam'), milestoneFor(900)],
      BRITTANI,
      daOf,
    );
    expect(groups.map((g) => g.label)).toEqual(['Marc', OWN_WORK_LABEL]);
    expect(groups.find((g) => g.label === OWN_WORK_LABEL)?.items).toHaveLength(2);
  });

  it('★★★ NO ROW IS EVER DROPPED — grouping is a partition, not a filter', () => {
    // The property that makes "not silently swallowed" checkable rather than
    // asserted: every row in, every row out, exactly once.
    const rows = [
      taskFor('Marc'),
      taskFor('Ahmadi'),
      taskFor('Cam'),
      taskFor('Brittani'),
      milestoneFor(900),
      milestoneFor(100),
    ];
    const out = groupItems(rows, BRITTANI, daOf).flatMap((g) => g.items);
    expect(out).toHaveLength(rows.length);
    expect(new Set(out.map((i) => i.key)).size).toBe(rows.length);
    for (const r of rows) expect(out).toContain(r);
  });

  it('★ a manager with no associates gets no groups at all', () => {
    expect(groupItems([taskFor('Marc')], [], daOf)).toEqual([
      { associate: null, label: OWN_WORK_LABEL, items: [expect.anything()] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// ★ §5 — the remembered choice
// ---------------------------------------------------------------------------

describe('fix-365 §5: the preference is per person', () => {
  beforeEach(() => window.localStorage.clear());

  it('★ it survives a reload', () => {
    saveBoardLens('brittani-uuid', { mode: 'group', focus: 'Marc' });
    expect(loadBoardLens('brittani-uuid')).toEqual({
      mode: 'group',
      focus: 'Marc',
    });
  });

  it('★★ …and TWO VIEWERS DO NOT FIGHT OVER IT', () => {
    // Two managers on one machine is a real thing in this office, and a shared
    // key is how they end up overwriting each other.
    saveBoardLens('brittani-uuid', { mode: 'group', focus: 'Marc' });
    saveBoardLens('jade-uuid', { mode: 'off', focus: 'Erick' });
    expect(loadBoardLens('brittani-uuid')).toEqual({ mode: 'group', focus: 'Marc' });
    expect(loadBoardLens('jade-uuid')).toEqual({ mode: 'off', focus: 'Erick' });
    // ★ Keyed on the auth user id, the same shape fix-176's scope preference
    // uses.
    expect(window.localStorage.getItem('boardLens.brittani-uuid')).toBeTruthy();
    expect(window.localStorage.getItem('boardLens.jade-uuid')).toBeTruthy();
  });

  it('★ an unknown or corrupt value is a preference, not an error', () => {
    expect(loadBoardLens(null)).toEqual(DEFAULT_BOARD_LENS);
    expect(loadBoardLens('nobody')).toEqual(DEFAULT_BOARD_LENS);
    window.localStorage.setItem('boardLens.broken', '{not json');
    expect(loadBoardLens('broken')).toEqual(DEFAULT_BOARD_LENS);
    window.localStorage.setItem('boardLens.odd', JSON.stringify({ mode: 'x', focus: 7 }));
    expect(loadBoardLens('odd')).toEqual(DEFAULT_BOARD_LENS);
  });

  it('★★ a focus on somebody who is no longer your associate is cleared', () => {
    // The roster changes while this screen is closed. A stale focus is not a
    // focus, it is an empty board.
    expect(reconcileLens({ mode: 'group', focus: 'Departed' }, BRITTANI)).toEqual({
      mode: 'group',
      focus: null,
    });
    expect(reconcileLens({ mode: 'group', focus: 'Marc' }, BRITTANI)).toEqual({
      mode: 'group',
      focus: 'Marc',
    });
    // ★ The MODE survives — they still asked for a grouped board.
    expect(reconcileLens({ mode: 'group', focus: 'Departed' }, BRITTANI).mode).toBe(
      'group',
    );
  });
});
