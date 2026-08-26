import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildForecast,
  buildQueue,
  type BoardInput,
  type BoardTask,
  type BoardViewer,
} from '../lib/myBoard';
import {
  excludeHeldWork,
  heldSetsFrom,
  holdRowFor,
  holdRowIndex,
  isHeldWork,
  NO_HELD_WORK,
} from '../lib/heldWork';
import {
  SHOW_HELD_WORK_DEFAULT,
  readShowHeldWork,
  resetShowHeldWorkCache,
  subscribeShowHeldWork,
  writeShowHeldWork,
} from '../lib/heldWorkPref';
import type {
  PermitCycle,
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// ===========================================================================
// fix-409 — held work knows it is held
// ===========================================================================
//
// Bobby, 2026-08-25 (register P-039):
//
//   "the default is you show all active projects/permits. anything with a hold
//    gets auto turned off, but you can switch that on/off in the my tasks/my
//    boards. and maybe when you turn it on in my tasks or my board, it will
//    turn them on together — that way they live together in display."
//
//   "it primarily lives in the my tasks and my board. the project overview
//    should show everything even if hold since this is the holistic view."
//
// ---------------------------------------------------------------------------
// ★★★ WHAT STEP 0 FOUND, AND WHERE THE BRIEF WAS WRONG
// ---------------------------------------------------------------------------
//
//   1. "LIVE" IS `hold_end === null`, NOT `hold_end >= today`. Every shipped
//      hold surface uses the OPEN ROW; the DB enforces at most one per
//      project/permit with a partial unique index. The brief's date rule would
//      keep a hold RELEASED TODAY alive for the rest of the day — §1 pins that.
//   2. THE MILESTONE HALF WAS ALREADY BUILT, by fix-390, as an absolute
//      (`if (isHeld) return false`). fix-409 does not add a gate there; it adds
//      a way BACK IN. §2 pins that the default is byte-identical to fix-390.
//   3. THE TASK HALF WAS NEVER BUILT AT ALL — the real bug. A held project's
//      tasks aged in the red buckets while its milestones stayed quiet.

const TODAY = '2026-08-26';

let pid = 0;
function mkPermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: ++pid,
    project_id: 'p1',
    type: 'Building Permit',
    status: null,
    num: null,
    stage: null,
    stage_override: null,
    da: 'Fisk',
    dm: null,
    ent_lead: 'Miles',
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    parent_permit_id: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: '2026-08-01T12:00:00Z',
    permit_cycles: [],
    ...over,
  } as PermitWithCycles;
}

let tid = 0;
function mkTask(over: Partial<BoardTask> = {}): BoardTask {
  return {
    id: `t${++tid}`,
    permit_id: 1,
    parent_task_id: null,
    project_id: 'p1',
    project_address: '3626 164th Pl SE',
    permit_type: 'Building Permit',
    bucket: 'de',
    text: 'Do the thing',
    start_date: null,
    target_date: '2026-08-01', // past due, so it lands in the forecast
    due_date: null,
    done_at: null,
    sort_order: 0,
    assigned_to: 'Miles',
    discipline: 'ent',
    status: 'Open',
    primary_assignee: 'Miles',
    co_assignees: [],
    ...over,
  } as BoardTask;
}

const mkProject = (id: string, address: string): Project =>
  ({ id, address, juris: 'Seattle', archived: false, notes: null }) as Project;

const mkCycle = (over: Partial<PermitCycle> = {}): PermitCycle =>
  ({
    id: 'c1',
    permit_id: 1,
    cycle_index: 1,
    submitted: null,
    intake_accepted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    created_at: '',
    updated_at: '',
    ...over,
  }) as PermitCycle;

const MILES: BoardViewer = { name: 'Miles', isOversight: false };

function input(over: Partial<BoardInput>): BoardInput {
  return {
    viewer: MILES,
    permits: [],
    projects: [mkProject('p1', '3626 164th Pl SE'), mkProject('p2', '55 Other St')],
    tasks: [],
    today: TODAY,
    ...over,
  };
}

/** An OPEN project_holds row. */
const openProjectHold = (
  projectId: string,
  kind: 'hold' | 'cancelled' = 'hold',
  reason = 'Waiting on builder',
) => ({
  project_id: projectId,
  kind,
  reason,
  note: 'note here',
  hold_start: '2026-08-01',
  hold_end: null as string | null,
});

/** A RELEASED project_holds row — closed, whatever the date says. */
const releasedProjectHold = (projectId: string, endedOn: string) => ({
  ...openProjectHold(projectId),
  hold_end: endedOn,
});

const openPermitHold = (permitId: number, reason = 'Permit paused') => ({
  permit_id: permitId,
  reason,
  note: null as string | null,
  hold_start: '2026-08-02',
  hold_end: null as string | null,
  kind: 'hold' as const,
});

// ---------------------------------------------------------------------------
// §1 · isHeld — the predicate, and the definition of "live"
// ---------------------------------------------------------------------------

describe('fix-409 §1: what counts as held', () => {
  it('★★★ a task on a project with an OPEN hold is held', () => {
    const sets = heldSetsFrom([openProjectHold('p1')], []);
    expect(isHeldWork({ permit_id: 1, project_id: 'p1' }, sets)).toBe(true);
    expect(isHeldWork({ permit_id: 1, project_id: 'p2' }, sets)).toBe(false);
  });

  it('★★★ a task on a permit with an OPEN hold is held, project moving or not', () => {
    // fix-390's smaller scope: one ULS paused while its BP proceeds.
    const sets = heldSetsFrom([], [openPermitHold(7)]);
    expect(isHeldWork({ permit_id: 7, project_id: 'p1' }, sets)).toBe(true);
    expect(isHeldWork({ permit_id: 8, project_id: 'p1' }, sets)).toBe(false);
  });

  it('★★★ kind=cancelled is NOT held — it is a different state, out of scope', () => {
    // Bobby: "hold and cancel are two different states." fix-264 already drops
    // cancelled work from every live-work surface; this must never claim it.
    const sets = heldSetsFrom([openProjectHold('p1', 'cancelled')], []);
    expect(isHeldWork({ permit_id: 1, project_id: 'p1' }, sets)).toBe(false);
  });

  it('★★★ "LIVE" IS THE OPEN ROW, NOT A DATE — a hold released TODAY is not held', () => {
    // ★ The brief said `hold_end IS NULL OR hold_end >= current_date`. Under
    //   that rule this row stays "live" for the rest of the day, so somebody
    //   who just lifted a hold would watch their work stay hidden. Every
    //   shipped surface uses the open row; so does this.
    const sets = heldSetsFrom([releasedProjectHold('p1', TODAY)], []);
    expect(isHeldWork({ permit_id: 1, project_id: 'p1' }, sets)).toBe(false);
  });

  it('★★ an EXPIRED hold is not held either', () => {
    const sets = heldSetsFrom([releasedProjectHold('p1', '2026-01-01')], []);
    expect(isHeldWork({ permit_id: 1, project_id: 'p1' }, sets)).toBe(false);
  });

  it('★★ no holds at all → nothing is held, and the filter is a no-op', () => {
    const rows = [
      { permit_id: 1, project_id: 'p1' },
      { permit_id: 2, project_id: 'p2' },
    ];
    expect(isHeldWork(rows[0], NO_HELD_WORK)).toBe(false);
    // ★ Same REFERENCE back — no copy on the common path.
    expect(excludeHeldWork(rows, NO_HELD_WORK, false)).toBe(rows);
  });

  it('★★★ the ONE-WAY RULE: a permit hold never makes its PROJECT held', () => {
    // fix-390's core ruling. A stuck ULS must not paint the BP beside it.
    const sets = heldSetsFrom([], [openPermitHold(7)]);
    expect(isHeldWork({ permit_id: 7, project_id: 'p1' }, sets)).toBe(true);
    // A DIFFERENT permit on the same project is untouched.
    expect(isHeldWork({ permit_id: 9, project_id: 'p1' }, sets)).toBe(false);
  });

  it('★★ excludeHeldWork drops exactly the held rows, and keeps them when shown', () => {
    const sets = heldSetsFrom([openProjectHold('p1')], []);
    const rows = [
      { permit_id: 1, project_id: 'p1' },
      { permit_id: 2, project_id: 'p2' },
    ];
    expect(excludeHeldWork(rows, sets, false).map((r) => r.permit_id)).toEqual([2]);
    expect(excludeHeldWork(rows, sets, true)).toBe(rows);
  });
});

// ---------------------------------------------------------------------------
// §1b · the chip
// ---------------------------------------------------------------------------

describe('fix-409 §1b: which hold explains the row', () => {
  it("★★★ the PERMIT's own hold wins over its project's — the more specific fact", () => {
    const index = holdRowIndex(
      [openProjectHold('p1', 'hold', 'Project paused')],
      [openPermitHold(1, 'Permit paused')],
    );
    expect(holdRowFor({ permit_id: 1, project_id: 'p1' }, index)?.reason).toBe(
      'Permit paused',
    );
  });

  it('★★ ...and it falls back to the project, which is the whole prod population', () => {
    // Re-measured on prod 2026-08-26 (read-only): 3 live project holds, 0 live
    // permit holds, 8 open tasks under them. Every chip anybody will actually
    // see comes from this branch — the permit branch above is the correct
    // precedence, not the common case.
    const index = holdRowIndex([openProjectHold('p1', 'hold', 'Waiting on builder')], []);
    expect(holdRowFor({ permit_id: 99, project_id: 'p1' }, index)?.reason).toBe(
      'Waiting on builder',
    );
  });

  it('★★★ a CANCELLED project is chipped "cancelled", never mislabelled "hold"', () => {
    // The one allowance the brief makes about cancel: if such a row renders
    // (the project overview filters nothing), it must not lie about which
    // state it is in.
    const index = holdRowIndex([openProjectHold('p1', 'cancelled', 'Builder pulled out')], []);
    expect(holdRowFor({ permit_id: 1, project_id: 'p1' }, index)?.kind).toBe(
      'cancelled',
    );
    // ★ ...while the SETS still refuse to treat it as held. Two questions, two
    //   filters — see the note in lib/heldWork.
    expect(
      isHeldWork(
        { permit_id: 1, project_id: 'p1' },
        heldSetsFrom([openProjectHold('p1', 'cancelled')], []),
      ),
    ).toBe(false);
  });

  it('★★ a RELEASED hold explains nothing', () => {
    const index = holdRowIndex([releasedProjectHold('p1', '2026-08-20')], []);
    expect(holdRowFor({ permit_id: 1, project_id: 'p1' }, index)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §2 · My Board — the default hides, the switch reveals
// ---------------------------------------------------------------------------

describe('fix-409 §2: the board', () => {
  it('★★★ THE BUG: a held project\'s TASKS are hidden by default', () => {
    // Before fix-409 this task sat in "past due", going redder, while every
    // milestone on the same permit stayed politely quiet.
    const permit = mkPermit({ id: 101, project_id: 'p1' });
    const t = mkTask({ permit_id: 101, project_id: 'p1' });
    const held = buildForecast(
      input({
        permits: [permit],
        tasks: [t],
        holdRows: [openProjectHold('p1')],
      }),
    );
    expect(held.past_due.items.map((i) => i.taskId)).not.toContain(t.id);

    // ★ Not held → present. The task itself is unremarkable.
    const free = buildForecast(input({ permits: [permit], tasks: [t] }));
    expect(free.past_due.items.map((i) => i.taskId)).toContain(t.id);
  });

  it('★★★ ...and the switch brings them back, wearing a chip', () => {
    const permit = mkPermit({ id: 102, project_id: 'p1' });
    const t = mkTask({ permit_id: 102, project_id: 'p1' });
    const shown = buildForecast(
      input({
        permits: [permit],
        tasks: [t],
        holdRows: [openProjectHold('p1', 'hold', 'Waiting on builder')],
        showHeldWork: true,
      }),
    );
    const row = shown.past_due.items.find((i) => i.taskId === t.id);
    expect(row).toBeTruthy();
    expect(row!.isHeld).toBe(true);
    // ★ The chip travels ON the row, so the component that draws it does not
    //   re-derive the answer three levels down.
    expect(row!.hold?.reason).toBe('Waiting on builder');
  });

  it('★★★ a PERMIT hold hides only its own permit\'s tasks', () => {
    const held = mkPermit({ id: 201, project_id: 'p1' });
    const free = mkPermit({ id: 202, project_id: 'p1' });
    const tHeld = mkTask({ permit_id: 201, project_id: 'p1' });
    const tFree = mkTask({ permit_id: 202, project_id: 'p1' });
    const f = buildForecast(
      input({
        permits: [held, free],
        tasks: [tHeld, tFree],
        permitHoldRows: [openPermitHold(201)],
      }),
    );
    const ids = f.past_due.items.map((i) => i.taskId);
    expect(ids).not.toContain(tHeld.id);
    expect(ids).toContain(tFree.id);
  });

  it('★★★ MILESTONES: the DEFAULT is byte-identical to fix-390', () => {
    // fix-390 silenced held permits absolutely. fix-409 must not change that
    // for anybody who has not touched the switch — the whole ~40-fixture board
    // suite depends on it, and so does everyone's Monday.
    const permit = mkPermit({
      id: 301,
      project_id: 'p1',
      target_submit: '2026-08-01',
    });
    const quiet = buildForecast(
      input({ permits: [permit], holdRows: [openProjectHold('p1')] }),
    );
    expect(quiet.past_due.items).toHaveLength(0);
    // ★ ...and the count of history-suppressed rows stays 0 too: a hold is
    //   state, not history.
    expect(quiet.suppressedHistoric).toBe(0);
  });

  it('★★★ ...and the switch un-silences them, which is new', () => {
    const permit = mkPermit({
      id: 302,
      project_id: 'p1',
      target_submit: '2026-08-01',
    });
    const shown = buildForecast(
      input({
        permits: [permit],
        holdRows: [openProjectHold('p1', 'hold', 'Waiting on builder')],
        showHeldWork: true,
      }),
    );
    const milestones = shown.past_due.items.filter((i) => i.source === 'milestone');
    expect(milestones.length).toBeGreaterThan(0);
    expect(milestones.every((m) => m.isHeld)).toBe(true);
    expect(milestones[0].hold?.reason).toBe('Waiting on builder');
  });

  it('★★ an UNHELD row carries no chip and claims nothing', () => {
    const permit = mkPermit({ id: 303, project_id: 'p2' });
    const t = mkTask({ permit_id: 303, project_id: 'p2' });
    const f = buildForecast(
      input({
        permits: [permit],
        tasks: [t],
        holdRows: [openProjectHold('p1')], // a DIFFERENT project
      }),
    );
    const row = f.past_due.items.find((i) => i.taskId === t.id)!;
    expect(row.isHeld).toBe(false);
    expect(row.hold).toBeNull();
  });

  it('★★ the QUEUE follows the same switch', () => {
    // The queue's city-review branch has read `!isHeld` since fix-390; it reads
    // `quiet` now, so the same switch governs both panels of one screen.
    const permit = mkPermit({
      id: 401,
      project_id: 'p1',
      permit_cycles: [mkCycle({ permit_id: 401, submitted: '2026-07-01' })],
    });
    const hidden = buildQueue(
      input({ permits: [permit], holdRows: [openProjectHold('p1')] }),
    );
    expect(hidden.rows).toHaveLength(0);

    const shown = buildQueue(
      input({
        permits: [permit],
        holdRows: [openProjectHold('p1', 'hold', 'Waiting on builder')],
        showHeldWork: true,
      }),
    );
    expect(shown.rows.length).toBeGreaterThan(0);
    expect(shown.rows[0].isHeld).toBe(true);
    expect(shown.rows[0].hold?.reason).toBe('Waiting on builder');
  });

  it('★★★ CANCEL still leaves the board entirely, switch or no switch', () => {
    // fix-262/264's treatment, untouched: a cancelled project's work is gone
    // via isCancelledProject, and the held-work switch must never resurrect it.
    const permit = mkPermit({ id: 501, project_id: 'p1' });
    const t = mkTask({ permit_id: 501, project_id: 'p1' });
    for (const showHeldWork of [false, true]) {
      const f = buildForecast(
        input({
          permits: [permit],
          tasks: [t],
          cancelledIds: new Set(['p1']),
          holdRows: [openProjectHold('p1', 'cancelled')],
          showHeldWork,
        }),
      );
      expect(f.past_due.items.map((i) => i.taskId)).not.toContain(t.id);
    }
  });

  it('★★ a fixture that never heard of holds behaves exactly as before', () => {
    // ★ The additive contract: `showHeldWork`, `holdRows` and `permitHoldRows`
    //   are all optional, so ~40 existing board fixtures pass none of them.
    const permit = mkPermit({ id: 601, project_id: 'p1' });
    const t = mkTask({ permit_id: 601, project_id: 'p1' });
    const f = buildForecast(input({ permits: [permit], tasks: [t] }));
    expect(f.past_due.items.map((i) => i.taskId)).toContain(t.id);
    expect(f.past_due.items[0].isHeld).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 · the shared preference
// ---------------------------------------------------------------------------

const USER = 'u-1';
const OTHER = 'u-2';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetShowHeldWorkCache();
});

describe('fix-409 §3: one switch, two screens', () => {
  it('★★★ the DEFAULT is off — Bobby: "anything with a hold gets auto turned off"', () => {
    expect(SHOW_HELD_WORK_DEFAULT).toBe(false);
    expect(readShowHeldWork(USER)).toBe(false);
  });

  it('★★★ ONE value: a write from either screen is what the other screen reads', () => {
    // There is no "my tasks" copy and no "my board" copy. Both call the same
    // reader, so "they live together in display" cannot drift.
    writeShowHeldWork(USER, true);
    expect(readShowHeldWork(USER)).toBe(true);
    writeShowHeldWork(USER, false);
    expect(readShowHeldWork(USER)).toBe(false);
  });

  it('★★★ every mounted reader is NOTIFIED — not just the one that wrote', () => {
    // ★ My Tasks and My Board are tabs today, so a read-on-mount would LOOK
    //   like it worked. fix-318 had these two panels stacked on one screen and
    //   fix-385 unstacked them a ticket later; the broadcast is what makes the
    //   requirement survive the next layout change.
    let hits = 0;
    const off = subscribeShowHeldWork(() => {
      hits += 1;
    });
    writeShowHeldWork(USER, true);
    expect(hits).toBe(1);
    // ★ Setting the SAME value notifies nobody — no needless re-render.
    writeShowHeldWork(USER, true);
    expect(hits).toBe(1);
    off();
    writeShowHeldWork(USER, false);
    expect(hits).toBe(1);
  });

  it('★★★ it SURVIVES A RELOAD in the same tab, and dies with the tab', () => {
    writeShowHeldWork(USER, true);
    // A reload: the module cache is gone, sessionStorage is not.
    resetShowHeldWorkCache();
    expect(readShowHeldWork(USER)).toBe(true);
    // A NEW TAB: sessionStorage is gone too, and the default returns — which is
    // Bobby's "the default is ... anything with a hold gets auto turned off".
    window.sessionStorage.clear();
    resetShowHeldWorkCache();
    expect(readShowHeldWork(USER)).toBe(false);
  });

  it('★★★ sessionStorage, never localStorage — a train of thought, not a preference', () => {
    writeShowHeldWork(USER, true);
    expect(window.sessionStorage.length).toBeGreaterThan(0);
    expect(window.localStorage.length).toBe(0);
  });

  it('★★ per USER — a shared machine never leaks one login\'s choice', () => {
    writeShowHeldWork(USER, true);
    expect(readShowHeldWork(OTHER)).toBe(false);
  });

  it('★★ with NO user id the switch still switches — it just does not persist', () => {
    // ★ fix-176 forbids storing anything without a user id, and the first cut
    //   of this made the CONTROL inert as a result: click, nothing, no error.
    //   The value works in memory; only the write is skipped.
    writeShowHeldWork(null, true);
    expect(readShowHeldWork(null)).toBe(true);
    expect(window.sessionStorage.length).toBe(0);
    // ...and it is not shared with a real login.
    expect(readShowHeldWork(USER)).toBe(false);
  });

  it('★★ a corrupt stored value reads as the default, never as a throw', () => {
    window.sessionStorage.setItem(`heldwork.show.${USER}`, '{not json');
    expect(readShowHeldWork(USER)).toBe(false);
    resetShowHeldWorkCache();
    window.sessionStorage.setItem(`heldwork.show.${USER}`, '"yes please"');
    expect(readShowHeldWork(USER)).toBe(false);
  });
});
