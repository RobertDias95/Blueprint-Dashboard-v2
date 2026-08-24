import { describe, it, expect } from 'vitest';
import myBoardSource from '../lib/myBoard.ts?raw';
import myBoardPageSource from '../pages/MyBoard.tsx?raw';
import boardBellSource from '../components/BoardBell.tsx?raw';
import {
  QUEUE_BANDS,
  QUEUE_KIND_RANK,
  bandFor,
  dueWordsFor,
  daysPastDueFor,
} from '../lib/projectQueue';
import { buildQueue, resolveBoardViewer, type BoardInput } from '../lib/myBoard';
import type { PermitWithCycles, Project } from '../lib/database.types';

// ===========================================================================
// fix-397 — the Project Queue becomes the owner's priority list
// ===========================================================================
//
// Bobby, 2026-08-24, off his own board screenshot:
//
//   "For 554 North 75th, there is something with a past due target date that
//    should be kind of at the top of the list … if you're assigned to a permit,
//    it's going to help sort by priority. So whatever is past due, of course,
//    would be at the top … But we have to have submittals, corrections, and
//    city review. So those are like the three main things."
//
// ★★★ THE SHAPE IS REAL, NOT INVENTED. Every fixture below is 554 N 75th's
// actual prod data on 2026-08-24: SDOTTRLA0002501 (SDOT Tree, ent_lead Bobby,
// submitted 08-18, city_target 08-21) and 004263-26PA (PAR/Pre-Sub, ent_lead
// Bobby, city_target 08-28), plus 004265-26PA at 233 31st Ave E and
// SDOTTRLA0002504 at 4137 54th Ave SW. On the old queue the SDOT Tree — three
// days past its target — sat at the BOTTOM, below the two PAR/Pre-Subs.

const TODAY = '2026-08-24'; // a Monday

const PROJECTS: Project[] = [
  { id: 'p-554', address: '554 N 75th St' },
  { id: 'p-4137', address: '4137 54th Ave SW' },
  { id: 'p-233', address: '233 31st Ave E' },
] as unknown as Project[];

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p-554',
    type: 'SDOT Tree',
    num: 'SDOTTRLA0002501',
    status: 'Initiated',
    da: null,
    ent_lead: 'Bobby',
    parent_permit_id: null,
    target_submit: null,
    intake_date: null,
    dd_end: null,
    approval_date: null,
    actual_issue: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: `${TODAY}T09:00:00Z`,
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

function cycle(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    permit_id: 1,
    cycle_index: 1,
    submitted: '2026-08-18',
    intake_accepted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

const BOBBY = resolveBoardViewer('Bobby', []);

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    viewer: BOBBY,
    permits: [],
    projects: PROJECTS,
    tasks: [],
    today: TODAY,
    ...over,
  } as BoardInput;
}

const q = (over: Partial<BoardInput> = {}) => buildQueue(input(over));

/** The real 554 N 75th SDOT Tree: submitted, city target three days ago. */
const SDOT_TREE = permit({
  id: 10378,
  permit_cycles: [cycle({ permit_id: 10378, city_target: '2026-08-21' })],
});

// ---------------------------------------------------------------------------
// §1 · THE 554 N 75th SHAPE — the bug, from the screenshot
// ---------------------------------------------------------------------------

describe('fix-397 §1: the past-due row leads the list', () => {
  it('★★★ 554 N 75th\'s SDOT Tree sorts to the TOP, past due, over later targets', () => {
    const rows = q({
      permits: [
        // The two PAR/Pre-Subs that outranked it on the real board.
        permit({
          id: 10375,
          project_id: 'p-554',
          type: 'PAR/Pre-Sub',
          num: '004263-26PA',
          status: 'In Process',
          permit_cycles: [cycle({ permit_id: 10375, city_target: '2026-08-28' })],
        }),
        permit({
          id: 10999,
          project_id: 'p-233',
          type: 'PAR/Pre-Sub',
          num: '004265-26PA',
          status: 'In Process',
          permit_cycles: [cycle({ permit_id: 10999, city_target: '2026-08-28' })],
        }),
        SDOT_TREE,
      ],
    }).rows;

    // ★★★ THE FIX, IN ONE ASSERTION: it is first, not last.
    expect(rows[0]!.num).toBe('SDOTTRLA0002501');
    expect(rows[0]!.band).toBe('past_due');
    expect(rows[0]!.dueWords).toBe('3d past due');
    expect(rows[0]!.daysPastDue).toBe(3);
    // ...and the ones that used to outrank it follow.
    expect(rows.slice(1).map((r) => r.num)).toEqual(['004265-26PA', '004263-26PA']);
  });

  it('★★★ FLAT, NOT GROUPED — one project with two due permits appears twice', () => {
    // Ruling 1, and 554 N 75th is the live example: its SDOT Tree leads the
    // list and its PAR/Pre-Sub sits below, as two independent rows.
    const rows = q({
      permits: [
        SDOT_TREE,
        permit({
          id: 10375,
          type: 'PAR/Pre-Sub',
          num: '004263-26PA',
          status: 'In Process',
          permit_cycles: [cycle({ permit_id: 10375, city_target: '2026-08-28' })],
        }),
      ],
    }).rows;
    expect(rows).toHaveLength(2);
    // The ADDRESS is the primary label on BOTH, and it is the same address.
    expect(rows.map((r) => r.address)).toEqual(['554 N 75th St', '554 N 75th St']);
    expect(rows.map((r) => r.permitId)).toEqual([10378, 10375]);
  });

  it('★★ the row carries what it must without being clicked', () => {
    const row = q({ permits: [SDOT_TREE] }).rows[0]!;
    expect(row.kind).toBe('city_review');
    expect(row.address).toBe('554 N 75th St');
    expect(row.num).toBe('SDOTTRLA0002501');
    expect(row.type).toBe('SDOT Tree');
    expect(row.cycleIndex).toBe(1);
    expect(row.due).toBe('2026-08-21');
    // The existing state sentence, not a new one.
    expect(row.stateLine).toBe('6d submitted, awaiting intake');
  });
});

// ---------------------------------------------------------------------------
// §2 · THE BANDS
// ---------------------------------------------------------------------------

describe('fix-397 §2: band assignment, against a fixed today', () => {
  it('★★★ every boundary, named', () => {
    expect(bandFor('2026-08-23', TODAY)).toBe('past_due'); // yesterday
    expect(bandFor('2026-08-24', TODAY)).toBe('today');
    expect(bandFor('2026-08-25', TODAY)).toBe('tomorrow');
    expect(bandFor('2026-08-26', TODAY)).toBe('this_week'); // +2, the first
    expect(bandFor('2026-08-31', TODAY)).toBe('this_week'); // +7, the last
    expect(bandFor('2026-09-01', TODAY)).toBe('later'); // +8, just over
    expect(bandFor(null, TODAY)).toBe('no_date');
  });

  it('★★ "this week" is a ROLLING seven days, not the calendar remainder', () => {
    // TODAY is a Monday. A calendar week would put +7 (next Monday) in "Later";
    // a rolling window keeps it in "This week" — and, more importantly, gives
    // the same answer whichever day of the week you look. Bobby's framing is
    // relative ("due in three days"), so the window is too.
    expect(bandFor('2026-08-30', TODAY)).toBe('this_week'); // the Sunday
    expect(bandFor('2026-08-31', TODAY)).toBe('this_week'); // the next Monday
  });

  it('★★ due-ness is always WORDS, and never blank', () => {
    expect(dueWordsFor('2026-08-21', TODAY)).toBe('3d past due');
    expect(dueWordsFor('2026-08-23', TODAY)).toBe('1d past due');
    expect(dueWordsFor('2026-08-24', TODAY)).toBe('due today');
    expect(dueWordsFor('2026-08-25', TODAY)).toBe('due tomorrow');
    expect(dueWordsFor('2026-08-28', TODAY)).toBe('due in 4d');
    expect(dueWordsFor(null, TODAY)).toBe('No target date');
  });

  it('★★ a missing date is NOT overdue — "unknown" and "late" are different', () => {
    expect(daysPastDueFor(null, TODAY)).toBeNull();
    expect(daysPastDueFor('2026-08-28', TODAY)).toBe(0);
    expect(daysPastDueFor('2026-08-21', TODAY)).toBe(3);
  });

  it('★★★ empty bands collapse to NOTHING — a band is a sort, not a checklist', () => {
    const built = q({ permits: [SDOT_TREE] });
    expect(built.bands).toHaveLength(1);
    expect(built.bands[0]!.band).toBe('past_due');
    expect(built.bands.map((b) => b.band)).not.toContain('today');
  });

  it('★ the band ORDER is the render order, most urgent first', () => {
    expect([...QUEUE_BANDS]).toEqual([
      'past_due',
      'today',
      'tomorrow',
      'this_week',
      'later',
      'no_date',
    ]);
  });

  it('★★ within a band, the earliest date leads', () => {
    const rows = q({
      permits: [
        permit({ id: 2, project_id: 'p-233', num: 'B', permit_cycles: [cycle({ permit_id: 2, city_target: '2026-08-10' })] }),
        permit({ id: 3, project_id: 'p-4137', num: 'C', permit_cycles: [cycle({ permit_id: 3, city_target: '2026-08-01' })] }),
      ],
    }).rows;
    expect(rows.map((r) => r.num)).toEqual(['C', 'B']);
  });
});

// ---------------------------------------------------------------------------
// §3 · THE THREE KINDS
// ---------------------------------------------------------------------------

describe('fix-397 §3: submittals, corrections and city review', () => {
  it('★★ SUBMITTAL — pre-submission with a target_submit, and the date is OURS', () => {
    const row = q({
      permits: [permit({ status: 'Pre-Submittal — GO', target_submit: '2026-08-28' })],
    }).rows[0]!;
    expect(row.kind).toBe('submittal');
    expect(row.due).toBe('2026-08-28');
  });

  it('★★ CITY REVIEW — submitted, unapproved; the date is the cycle city_target', () => {
    const row = q({ permits: [SDOT_TREE] }).rows[0]!;
    expect(row.kind).toBe('city_review');
    expect(row.due).toBe('2026-08-21');
  });

  it('★★★ CORRECTIONS — and its date is NULL, which is the finding', () => {
    // ★★★ THE MODEL CARRIES NO RESUBMIT TARGET FOR THE CURRENT ROUND. The only
    // date columns are permit_cycles.city_target (the CITY's clock — forbidden
    // here, and rightly: it answers "when will they reply", not "when will
    // we"), corr_issued and resubmitted (records of what already happened), and
    // permits.target_submit (the FIRST submittal, behind us once corrections
    // exist). permitMilestones has said so since fix-337 in as many words:
    // "Corrections — a STATE, no inherent date".
    //
    // A PROJECTED resubmit does exist in projectedApproval.ts (corr_issued plus
    // the learned team turnaround) — but that is a forecast of when we probably
    // will, not a target anybody committed to, and sorting a priority list by
    // it would put a guess where a promise belongs.
    const row = q({
      permits: [
        permit({
          status: 'Corrections Required',
          permit_cycles: [cycle({ corr_issued: '2026-08-10', resubmitted: null })],
        }),
      ],
    }).rows[0]!;
    expect(row.kind).toBe('corrections');
    expect(row.due).toBeNull();
    expect(row.band).toBe('no_date');
    expect(row.dueWords).toBe('No target date');
    // ★ …and the row still says what is going on, so "no date" is not "no info".
    expect(row.stateLine).toContain('in corrections');
  });

  it('★★★ PRECEDENCE — corrections beats city review, and shows ONCE', () => {
    // A permit with corrections in hand is also, literally, "submitted and not
    // yet approved". The redlines are the question; the city's target is not.
    const rows = q({
      permits: [
        permit({
          status: 'Corrections Required',
          permit_cycles: [
            cycle({ corr_issued: '2026-08-10', resubmitted: null, city_target: '2026-08-21' }),
          ],
        }),
      ],
    }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('corrections');
    expect(QUEUE_KIND_RANK.corrections).toBeLessThan(QUEUE_KIND_RANK.city_review);
  });

  it('★★ the other two overlaps are UNREACHABLE, not merely unhandled', () => {
    // corrections needs a cycle with corr_issued (so something was submitted);
    // target_submit requires nothing has EVER been submitted. Both cannot hold,
    // and the same argument rules out submittal ∩ city_review.
    const withBoth = q({
      permits: [
        permit({
          status: 'Corrections Required',
          target_submit: '2026-01-01',
          permit_cycles: [cycle({ corr_issued: '2026-08-10' })],
        }),
      ],
    }).rows;
    expect(withBoth.map((r) => r.kind)).toEqual(['corrections']);
  });

  it('★ a permit with nothing to say is in no band at all', () => {
    // Pre-submittal with no target date: no kind, no row. It is not "No target
    // date" — it is not queue work.
    expect(q({ permits: [permit({ status: 'Pre-Submittal — GO' })] }).rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 · WHAT DOES NOT APPEAR
// ---------------------------------------------------------------------------

describe('fix-397 §4: every silence gate excludes its permit', () => {
  const submitted = () => [SDOT_TREE];

  it('★ the control appears, so each gate below is the ONE thing changed', () => {
    expect(q({ permits: submitted() }).total).toBe(1);
  });

  it('★★★ a held PERMIT is quiet (fix-390)', () => {
    expect(
      q({ permits: submitted(), permitHoldRows: [{ permit_id: 10378, hold_end: null }] }).total,
    ).toBe(0);
  });

  it('★★★ a held PROJECT is quiet too — both scopes (fix-391)', () => {
    expect(
      q({
        permits: submitted(),
        holdRows: [{ project_id: 'p-554', hold_end: null, kind: 'hold' }],
      }).total,
    ).toBe(0);
  });

  it('★★★ a cancelled project is gone (fix-262), and cancel is not hold', () => {
    expect(q({ permits: submitted(), cancelledIds: new Set(['p-554']) }).total).toBe(0);
    // ★ An open CANCEL row is not a hold — fix-391's rule, still true here.
    expect(
      q({
        permits: submitted(),
        holdRows: [{ project_id: 'p-554', hold_end: null, kind: 'cancelled' }],
      }).total,
    ).toBe(1);
  });

  it('★★★ a terminal-negative status raises nothing (fix-388)', () => {
    expect(
      q({ permits: [permit({ ...SDOT_TREE, status: 'Withdrawn' } as Partial<PermitWithCycles>)] })
        .total,
    ).toBe(0);
  });

  it('★★ issued and approved are out of scope, per each kind\'s own rule', () => {
    expect(q({ permits: [permit({ ...SDOT_TREE, actual_issue: '2026-08-20' } as Partial<PermitWithCycles>)] }).total).toBe(0);
    expect(q({ permits: [permit({ ...SDOT_TREE, approval_date: '2026-08-20' } as Partial<PermitWithCycles>)] }).total).toBe(0);
  });

  it('★★★ backfill/history suppresses the PLAN-date kinds only (fix-378/386)', () => {
    // ★★ THE ASYMMETRY IS DELIBERATE AND IT IS THE INTERESTING PART. The
    // history/backfill gate exists for dates the TEAM set — target_submit, draw
    // — because a backfilled project's plan dates are a record of the past.
    // A city_target is the CITY's date on live work, so suppressing it because
    // the project was entered retroactively would hide real city review.
    const backfilled = [{ id: 'p-554', address: '554 N 75th St', is_backfill: true }] as unknown as Project[];
    expect(
      q({
        permits: [permit({ status: 'Pre-Submittal — GO', target_submit: '2026-08-28' })],
        projects: backfilled,
      }).total,
    ).toBe(0);
    expect(q({ permits: submitted(), projects: backfilled }).total).toBe(1);
  });

  it('★ sub-permits never appear — the same rule the old queue applied', () => {
    // `prepare()` drops them (fix-194): a sub-permit is reviewed under a parent
    // and carries no independent assignment. Unchanged by this ticket.
    expect(
      q({ permits: [permit({ ...SDOT_TREE, parent_permit_id: 1 } as Partial<PermitWithCycles>)] })
        .total,
    ).toBe(0);
  });

  it('★ NO_ISSUANCE types get no special case — the old queue gave them none', () => {
    // buildAging and buildQueue both ignore NO_ISSUANCE_PERMIT_TYPES entirely,
    // so a ULS is queued like anything else. Stated rather than assumed: 3 of
    // the 11 rows on Bobby's real board are IPR/ULS-family permits.
    expect(
      q({
        permits: [permit({ ...SDOT_TREE, type: 'ULS' } as Partial<PermitWithCycles>)],
      }).rows.map((r) => r.type),
    ).toEqual(['ULS']);
  });
});

// ---------------------------------------------------------------------------
// §5 · WHOSE PERMITS
// ---------------------------------------------------------------------------

describe('fix-397 §5: the viewer resolver is the board\'s existing one', () => {
  it('★★ an ENT lead sees their permits, and only theirs', () => {
    expect(q({ permits: [SDOT_TREE] }).total).toBe(1);
    expect(
      buildQueue(input({ viewer: resolveBoardViewer('Briana', []), permits: [SDOT_TREE] }))
        .total,
    ).toBe(0);
  });

  it('★★ a DA sees their own leg', () => {
    const p = permit({ ...SDOT_TREE, ent_lead: null, da: 'Cam' } as Partial<PermitWithCycles>);
    expect(
      buildQueue(input({ viewer: resolveBoardViewer('Cam', []), permits: [p] })).total,
      // ★ ...but see fix-308b below: a DA-shaped viewer gets corrections only.
    ).toBe(0);
  });

  it('★★★ a DM sees their associates\' permits, by the SAME resolver (fix-365/379)', () => {
    // fix-306/365's `scopeNames` is how a manager looks at their team's work.
    // This ticket adds no second ownership concept — it consumes that one, so
    // the DM's queue fills with no new machinery. The bands stay OUTERMOST
    // (urgency first) and every row carries `owner`, which is all a
    // group-by-associate view needs.
    const cams = permit({
      ...SDOT_TREE,
      ent_lead: 'Cam',
    } as Partial<PermitWithCycles>);
    const asDm = buildQueue(
      input({
        viewer: resolveBoardViewer('Fisk', []),
        permits: [cams],
        scopeNames: ['Cam'],
      }),
    );
    expect(asDm.total).toBe(1);
    expect(asDm.rows[0]!.owner).toBe('Cam');
    // Without the scope, Fisk owns no leg here and sees nothing.
    expect(
      buildQueue(input({ viewer: resolveBoardViewer('Fisk', []), permits: [cams] })).total,
    ).toBe(0);
  });

  it('★★ fix-308b survives: a DA-shaped viewer gets corrections, not city review', () => {
    // fix-308b decided this explicitly and pinned it with a rendered test on
    // prod permit 165. fix-397 reshaped the vocabulary, not the ruling.
    const daOnly = (over: Partial<PermitWithCycles>) =>
      buildQueue(
        input({
          viewer: resolveBoardViewer('Cam', []),
          permits: [permit({ ent_lead: null, da: 'Cam', ...over })],
        }),
      );
    expect(daOnly({ permit_cycles: [cycle({ city_target: '2026-08-21' })] }).total).toBe(0);
    expect(
      daOnly({
        status: 'Corrections Required',
        permit_cycles: [cycle({ corr_issued: '2026-08-10' })],
      }).rows.map((r) => r.kind),
    ).toEqual(['corrections']);
  });
});

// ---------------------------------------------------------------------------
// §6 · WHAT MUST NOT BREAK
// ---------------------------------------------------------------------------

/** ★ Comment-stripped: these files discuss the removed sections at length, in
 *  prose, precisely BECAUSE they were removed. Asserting against the raw text
 *  would match the explanation — the trap fix-387 and fix-390 both hit. */
const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('fix-397 §6: prior contracts', () => {
  it('★★★ "Blocked on you" and "Waiting on design" are GONE from the queue', () => {
    const page = stripComments(myBoardPageSource);
    expect(page).not.toContain('Blocked on you');
    expect(page).not.toContain('Waiting on design');
    // ★ …and the ruling is recorded, in Bobby's words, where they died. Both
    //   files wrap the quote across lines, so the assertion is on the longest
    //   fragment that survives wrapping in each.
    expect(myBoardPageSource).toContain('built out in depth better');
    expect(myBoardSource).toContain('built out in depth better');
  });

  it('★★ …and from the bell, which counted them', () => {
    const bell = stripComments(boardBellSource);
    expect(bell).not.toContain('Blocked on you');
    expect(bell).not.toContain('Waiting on design');
    // The bell still answers "where you stand", in the new vocabulary.
    expect(bell).toContain('Queue · past due');
  });

  it('★★★ the FORECAST column is untouched — this is the right column only', () => {
    // The forecast's own buckets, its blend of milestones and tasks, and its
    // section builder are all still there and still referenced.
    const src = stripComments(myBoardSource);
    expect(src).toContain('export function buildForecast');
    expect(src).toContain('forecastSection');
    expect(src).toMatch(/past_due:\s*BoardSection<ForecastItem>/);
  });

  it('★★★ ONE QUERY (fix-318): the queue derives, it does not fetch', () => {
    // ★ Asserted the fix-385 way — no new hook is mounted. buildQueue takes the
    // caches the board already reads and returns rows; it opens no subscription
    // and issues no second fetch of permits.
    const src = stripComments(myBoardSource);
    expect(src).not.toMatch(/\buseQuery\b|\bsupabase\b/);
    // ★ Scoped to buildQueue's OWN body — slicing to end-of-file would sweep in
    //   every function after it and prove nothing about this one.
    const from = myBoardSource.indexOf('export function buildQueue(input: BoardInput)');
    expect(from).toBeGreaterThan(-1);
    const queue = stripComments(
      myBoardSource.slice(from, myBoardSource.indexOf('\n}', from) + 2),
    );
    expect(queue).toContain('prepare(input)');
    expect(queue).not.toMatch(/fetch|subscribe|channel|useQuery/i);
    // The page gained no data hook for the queue either — it renders what
    // buildQueueForScope returns from the existing input.
    expect(stripComments(myBoardPageSource)).toContain('buildQueueForScope');
  });

  it('★★ the relay machinery is left standing, not orphaned by accident', () => {
    // Bobby left the door open for a richer "blocked on you". relayStateFor and
    // the verbs still drive the forecast, so they stay — and the note saying so
    // is what stops the next reader deleting them as dead code.
    expect(myBoardSource).toContain('export function relayStateFor');
    expect(myBoardSource).toContain('THE RELAY MACHINERY BELOW IS DELIBERATELY LEFT STANDING');
  });

  it('★★ reviewer_silent is kept and its loss of a surface is on the record', () => {
    // It carried date: null, buildForecast skips those, and its only renderer
    // was "Blocked on you". fix-395 turned the same question into a real task
    // with an owner, which is why removing the prompt is coherent rather than
    // a regression — and why the rule itself is preserved.
    expect(myBoardSource).toContain('THIS OCCURRENCE NO LONGER REACHES A SCREEN');
    expect(myBoardSource).toContain('city_target_chase');
  });

  it('★ no row is written — the queue is display and derivation only', () => {
    const src = stripComments(myBoardSource);
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });
});
