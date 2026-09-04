import { describe, it, expect } from 'vitest';
import {
  VENDOR_PIPELINE_STATUSES,
  buildVendorTransmitRows,
  consultantByProject,
  designPhaseProjectIds,
  allPermitsDoneProjectIds,
  buildVendorScheduleRows,
  splitVendorSections,
  buildVendorCorrectionRows,
  drawBlockIsVendorVisible,
  forecastTargetSend,
  resolveForecastDiscipline,
  vendorKeyForDiscipline,
  vendorRowIsOverdue,
  vendorSentPayload,
  vendorTargetSend,
  lastSentAt,
  type ConsultantRoundFacts,
  type VendorLedgerRow,
} from '../lib/vendorReport';
import type {
  DrawScheduleRow,
  Project,
  ProjectHold,
  WaitingOnTaskRow,
} from '../lib/database.types';

// fix-265: the Vendor Schedule Forecast's pure core.
//
// The feature replaces a hand-written weekly email that was late about half the
// time and only ever carried NEW projects, while 57 start-week and 91 end-week
// moves went untold. So the two things these tests guard hardest are (a) change
// detection against the ledger, and (b) the running-list rule — that already-sent
// rows never fall off the pipeline.

const TODAY = '2026-08-03';

function project(over: Partial<Project> & { id: string }): Project {
  return {
    address: `${over.id} Main St`,
    juris: 'Seattle',
    archived: false,
    ...over,
  } as Project;
}

function block(
  over: Partial<DrawScheduleRow> & { project_id: string },
): DrawScheduleRow {
  return {
    da_assigned: null,
    start_week: '2026-08-10',
    end_week: '2026-09-14',
    status: 'Scheduled',
    manual_status: false,
    manually_placed: false,
    dd_start: null,
    dd_end: '2026-09-18',
    notes: null,
    color_override: null,
    status_override: null,
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  } as DrawScheduleRow;
}

// ★★★ fix-499 (P-034): THE CONSULTANT RECORD IS THE MEMBERSHIP SIGNAL NOW.
//
// Every test below was written when a draw block alone put a project on this
// report. It does not any more — a project is here because somebody recorded a
// consultant on it, and the round's status says which section it lands in.
//
// ★★ So `build()` seeds a `Scheduled` round for every fixture project unless a
//    test says otherwise. That is not papering over the change: `Scheduled`
//    ("nothing sent yet") is exactly the state those tests implicitly assumed,
//    and it is the state 37 of 43 live Structural rounds on prod are in. The
//    tests that are ABOUT membership pass their own rounds.
function consultant(
  over: Partial<ConsultantRoundFacts> & { project_id: string },
): ConsultantRoundFacts {
  return {
    discipline: 'Structural',
    firm_name: 'SSS',
    firm_active: true,
    status: 'Scheduled',
    est_send: null,
    sent: null,
    est_recd: null,
    ...over,
  };
}

function rounds(...rows: ConsultantRoundFacts[]): Map<string, ConsultantRoundFacts> {
  return consultantByProject(rows, 'Structural');
}

function ledger(over: Partial<VendorLedgerRow> & { project_id: string }): VendorLedgerRow {
  return {
    sent_start_week: '2026-08-10',
    // fix-309 #48: the ledger holds the DERIVED target send, so it is the
    // block's default dd_end (2026-09-18) MINUS the one-week send lead.
    sent_dd_end: '2026-09-11',
    sent_status: 'Scheduled',
    sent_at: '2026-07-27T17:00:00Z',
    ...over,
  };
}

function build(opts: {
  draw: DrawScheduleRow[];
  projects: Project[];
  ledger?: VendorLedgerRow[];
  cancelledIds?: Set<string>;
  holdsByProject?: Map<string, ProjectHold>;
  allPermitsDoneIds?: Set<string>;
  consultants?: Map<string, ConsultantRoundFacts>;
}) {
  return buildVendorScheduleRows({
    draw: opts.draw,
    projects: opts.projects,
    ledger: opts.ledger ?? [],
    cancelledIds: opts.cancelledIds,
    holdsByProject: opts.holdsByProject,
    allPermitsDoneIds: opts.allPermitsDoneIds,
    // ★ Default: a Scheduled round on every fixture project — see above.
    consultants:
      opts.consultants ??
      rounds(...opts.projects.map((p) => consultant({ project_id: p.id }))),
    todayIso: TODAY,
  });
}

// fix-266: the pipeline is a PHASE question, not a date question. Structural's
// involvement ends when the drawings go to the city, so only pre-submittal
// statuses belong. Before this, the pipeline rendered 66 prod rows of which 39
// were finished Approved work (oldest start 2025-02-10) — the dd_end filter
// could not fire because dd_end is NULL on 84 of 124 blocks.
describe('fix-266 pipeline is pre-submittal only', () => {
  const p = project({ id: 'p1' });

  function visible(status: string | null) {
    return drawBlockIsVendorVisible(
      block({ project_id: 'p1', status }),
      p,
      new Set(),
    );
  }

  it.each([['Scheduled'], ['Schematic'], ['DD / Permit Set'], ['Pending Consultants']])(
    'INCLUDES the pre-submittal status %s',
    (status) => {
      expect(visible(status)).toBe(true);
    },
  );

  it.each([['Submitted'], ['Under Review'], ['Corrections'], ['Approved']])(
    'EXCLUDES the post-submittal status %s',
    (status) => {
      expect(visible(status)).toBe(false);
    },
  );

  it('the allow-list is exactly the four pre-submittal phases', () => {
    // Pinned so adding a status to the draw schedule cannot quietly widen what
    // goes out to a vendor — a new status is OUT until someone decides it is
    // pre-submittal.
    expect([...VENDOR_PIPELINE_STATUSES].sort()).toEqual([
      'DD / Permit Set',
      'Pending Consultants',
      'Scheduled',
      'Schematic',
    ]);
  });

  it('KEEPS a block with no status — we cannot prove it is past submittal', () => {
    // Same principle as the blank dd_end: silently dropping a project the vendor
    // needs to hear about is worse than one extra row. Zero prod rows today.
    expect(visible(null)).toBe(true);
    expect(visible('   ')).toBe(true);
  });

  it('★★★ SUPERSEDED BY fix-499: a passed dd_end no longer HIDES the row', () => {
    // ★★★ THIS ASSERTION IS INVERTED, AND THAT IS THE TICKET. fix-266 read
    //     `.toBe(false)`: a block whose target send had passed was dropped,
    //     because with no transmit task there was "no evidence the work is
    //     still live". A Scheduled consultant round IS that evidence, and it is
    //     the state nearly every live round is in — so the row now stays and is
    //     marked OVERDUE instead of vanishing on the day it most needs saying.
    expect(
      drawBlockIsVendorVisible(
        block({ project_id: 'p1', status: 'Scheduled', dd_end: '2026-08-02' }),
        p,
        new Set(),
      ),
    ).toBe(true);
    // ★★ …and here is where the date went: it decides the OVERDUE flag now,
    //    asked of the round rather than of a task.
    const rows = build({
      draw: [block({ project_id: 'p1', status: 'Scheduled', dd_end: '2026-08-02', end_week: null })],
      projects: [p],
    });
    expect(rows.map((r) => r.projectId)).toEqual(['p1']);
    expect(rows[0].overdue).toBe(true);
  });

  it('drops Approved and Under Review rows from every schedule section', () => {
    const rows = build({
      draw: [
        block({ project_id: 'p1', status: 'Scheduled' }),
        block({ project_id: 'p2', status: 'Approved' }),
        block({ project_id: 'p3', status: 'Under Review' }),
      ],
      projects: [
        project({ id: 'p1', address: '100 A St' }),
        project({ id: 'p2', address: '200 B St' }),
        project({ id: 'p3', address: '300 C St' }),
      ],
    });
    const sections = splitVendorSections(rows);
    expect(sections.pipelineRows.map((r) => r.projectId)).toEqual(['p1']);
    expect(sections.newRows.map((r) => r.projectId)).toEqual(['p1']);
  });

  it('an Under Review project with a live structural correction STILL reaches section 4', () => {
    // This is why excluding Under Review from the pipeline costs nothing: the
    // corrections section is a task-level view and this gate does not touch it.
    const underReview = project({
      id: 'p1',
      address: '100 A St',
      external_team: { Structural: 'SSS' },
    } as Partial<Project> & { id: string });

    const sections = splitVendorSections(
      build({
        draw: [block({ project_id: 'p1', status: 'Under Review' })],
        projects: [underReview],
      }),
    );
    expect(sections.pipelineRows).toHaveLength(0);

    const corrections = buildVendorCorrectionRows(
      [task({ task_id: 't1', project_id: 'p1' })],
      [underReview],
      'Structural',
      designPhaseProjectIds([block({ project_id: 'p1', status: 'Under Review' })]),
    );
    expect(corrections.map((r) => r.taskId)).toEqual(['t1']);
  });
});

// ===========================================================================
// fix-268 / fix-269 REWRITTEN BY fix-499 — the ROUND is the liveness signal
// ===========================================================================
//
// These two describes tested a design handoff built out of `permit_tasks`: a
// "Structural - Transmitted" task whose start_date meant sent and whose
// resolution meant received, plus a precedence rule for a project carrying
// several of them.
//
// ★★★ NONE OF THAT IS DELETED SO MUCH AS RE-HOMED. Every state it modelled now
//     lives on the consultant round, recorded once per discipline by the person
//     doing the work rather than inferred from a task nobody may have made:
//
//       no consultant record  ← was `none` with no task
//       Scheduled             ← was `open` (a task, nothing sent)
//       Pending               ← was `started` (start_date set)
//       Received              ← was `resolved`
//
// ★★★ ONE RULING INVERTED, and it is named as superseded below: `none + PAST
//     target → DROP`. fix-269 reasoned that without a task there was "no
//     evidence the work is still live". That was true of tasks. A Scheduled
//     round IS that evidence — 37 of 43 live Structural rounds on prod are in
//     exactly that state — so the row stays and is flagged OVERDUE.
//
// ★ The precedence rule (started > open > resolved) is gone with nothing to
//   replace it, and is not missed: `project_consultants` is unique on
//   (project, discipline), so there is exactly one current round to read.
describe('fix-499: the consultant round decides the section', () => {
  const withSss = project({
    id: 'p1',
    address: '554 N 75th St',
    external_team: { Structural: 'SSS' },
  } as Partial<Project> & { id: string });

  function sections(round: ConsultantRoundFacts, status = 'Scheduled') {
    const draw = [block({ project_id: 'p1', status })];
    const map = rounds(round);
    return {
      transmitted: buildVendorTransmitRows(map, [withSss]),
      pipeline: splitVendorSections(
        build({ draw, projects: [withSss], consultants: map }),
      ).pipelineRows,
    };
  }

  it('★★★ Scheduled: in the PIPELINE, not in TRANSMITTED — nothing has gone out', () => {
    const s = sections(consultant({ project_id: 'p1', status: 'Scheduled' }));
    expect(s.transmitted).toHaveLength(0);
    expect(s.pipeline.map((r) => r.projectId)).toEqual(['p1']);
  });

  it('★★★ Pending: in TRANSMITTED, ABSENT from the pipeline', () => {
    const s = sections(
      consultant({
        project_id: 'p1',
        status: 'Pending',
        sent: '2026-09-18',
        est_recd: '2026-10-02',
      }),
    );
    expect(s.transmitted.map((r) => r.projectId)).toEqual(['p1']);
    expect(s.transmitted[0].sent).toBe('2026-09-18');
    expect(s.transmitted[0].expectedBack).toBe('2026-10-02');
    expect(s.pipeline).toHaveLength(0);
  });

  it('★★★ Received: in NEITHER — it falls off, and the round is the record', () => {
    // Bobby: "once it's completed, it would fall off this list." No ledger
    // write, no tombstone, nothing to tidy up afterwards.
    const s = sections(
      consultant({ project_id: 'p1', status: 'Received', sent: '2026-09-18', recd: '2026-10-01' } as never),
    );
    expect(s.transmitted).toHaveLength(0);
    expect(s.pipeline).toHaveLength(0);
  });

  it('★★★ NO consultant record at all → the project is not on the report', () => {
    // ★★ THE BIGGEST BEHAVIOURAL CHANGE IN THE TICKET. A draw block alone used
    //    to be enough. The consultant record is the membership signal now.
    const rows = build({
      draw: [block({ project_id: 'p1' })],
      projects: [withSss],
      consultants: rounds(),
    });
    expect(rows).toHaveLength(0);
  });

  it('★★ a round for a DIFFERENT discipline does not put a project on this report', () => {
    const map = consultantByProject(
      [consultant({ project_id: 'p1', discipline: 'Civil' })],
      'Structural',
    );
    expect(map.size).toBe(0);
    expect(
      build({ draw: [block({ project_id: 'p1' })], projects: [withSss], consultants: map }),
    ).toHaveLength(0);
  });

  it('★★ Pending on a CANCELLED project is ignored', () => {
    expect(
      buildVendorTransmitRows(
        rounds(consultant({ project_id: 'p1', status: 'Pending', sent: '2026-09-18' })),
        [withSss],
        new Set(['p1']),
      ),
    ).toHaveLength(0);
  });

  it('★★ Transmitted carries the scope columns, like every other section', () => {
    const scoped = project({
      id: 'p1',
      address: '554 N 75th St',
      units: 3,
      product_types: ['SFR', 'ADU'],
    } as Partial<Project> & { id: string });
    const row = buildVendorTransmitRows(
      rounds(consultant({ project_id: 'p1', status: 'Pending', sent: '2026-09-18' })),
      [scoped],
    )[0];
    expect(row.units).toBe(3);
    expect(row.productTypes).toEqual(['SFR', 'ADU']);
  });

  it('★★ a Pending round with no est_recd renders BLANK, not an invented date', () => {
    // 5 of 165 consultant records on prod carry one. Deriving it from a lead
    // time would put a commitment nobody made in front of an outside engineer.
    const row = buildVendorTransmitRows(
      rounds(consultant({ project_id: 'p1', status: 'Pending', sent: '2026-09-18' })),
      [withSss],
    )[0];
    expect(row.expectedBack).toBeNull();
  });
});

// ===========================================================================
// fix-499 — the target send: round date wins, the schedule fills the gap
// ===========================================================================
//
// Bobby, 2026-09-04. Measured on prod the same day: `est_send` is set on
// exactly ONE of 165 consultant records, so in practice every visible row's
// target send comes from the schedule today. The rule exists for the day that
// changes, and the round's own date must win when it does.
describe('fix-499: target send — round date wins, schedule fills the gap', () => {
  const withSss = project({
    id: 'p1',
    address: '4060 E Via Estrella',
    juris: 'Phoenix',
    external_team: { Structural: 'SSS' },
  } as Partial<Project> & { id: string });

  const FUTURE = '2026-09-18';
  const PAST = '2026-03-27';
  /** fix-309 #48: the anchor minus the one-week send lead. */
  const PAST_TARGET_SEND = '2026-03-20';
  const FUTURE_TARGET_SEND = '2026-09-11';

  function upcoming(ddEnd: string | null, round?: Partial<ConsultantRoundFacts>) {
    return build({
      draw: [block({ project_id: 'p1', dd_end: ddEnd, end_week: null })],
      projects: [withSss],
      consultants: rounds(consultant({ project_id: 'p1', ...round })),
    });
  }

  it('★★★ a stated est_send WINS over the schedule-derived date', () => {
    // FAILS ON origin/main: the round was never read at all there.
    const rows = upcoming(FUTURE, { est_send: '2026-09-01' });
    expect(rows[0].targetSend).toBe('2026-09-01');
  });

  it('★★★ est_send NULL falls back to the schedule-derived date', () => {
    const rows = upcoming(FUTURE);
    expect(rows[0].targetSend).toBe(FUTURE_TARGET_SEND);
  });

  it('★★★ neither a stated date nor a block → the project is ABSENT', () => {
    // An undated row in a "coming to you" list is an invented commitment.
    const rows = build({
      draw: [],
      projects: [withSss],
      consultants: rounds(consultant({ project_id: 'p1' })),
    });
    expect(rows).toHaveLength(0);
  });

  it('★★ a round with est_send but NO block is listed on its own date', () => {
    const rows = build({
      draw: [],
      projects: [withSss],
      consultants: rounds(consultant({ project_id: 'p1', est_send: '2026-09-01' })),
    });
    expect(rows.map((r) => r.projectId)).toEqual(['p1']);
    expect(rows[0].targetSend).toBe('2026-09-01');
  });

  it('forecastTargetSend is the rule in one place', () => {
    const blk = { dd_end: FUTURE, end_week: null };
    expect(forecastTargetSend({ est_send: '2026-09-01' }, blk)).toBe('2026-09-01');
    expect(forecastTargetSend({ est_send: null }, blk)).toBe(FUTURE_TARGET_SEND);
    expect(forecastTargetSend(undefined, blk)).toBe(FUTURE_TARGET_SEND);
    expect(forecastTargetSend({ est_send: null }, undefined)).toBeNull();
  });

  // ---- the decision table, one case per row ----

  it('Scheduled + FUTURE target → UPCOMING, not flagged', () => {
    const rows = upcoming(FUTURE);
    expect(rows.map((r) => r.projectId)).toEqual(['p1']);
    expect(rows[0].overdue).toBe(false);
  });

  it('★★★ SUPERSEDED BY fix-499 — Scheduled + PAST target → OVERDUE, was DROP', () => {
    // ★★★ THE INVERTED RULING. fix-269 asserted `toHaveLength(0)` here: with no
    //     transmit task there was "no evidence the work is still live". The
    //     round is that evidence now, so the row stays, sorts first and says so.
    //     THE Via Estrella shape: target send four months ago, nothing sent,
    //     project demonstrably live.
    const rows = upcoming(PAST);
    expect(rows.map((r) => r.projectId)).toEqual(['p1']);
    expect(rows[0].overdue).toBe(true);
    expect(rows[0].targetSend).toBe(PAST_TARGET_SEND);
  });

  it.each([[FUTURE], [PAST]])(
    'Pending + %s target → not in UPCOMING (it is in TRANSMITTED)',
    (target) => {
      expect(upcoming(target, { status: 'Pending', sent: '2026-07-01' })).toHaveLength(0);
    },
  );

  it.each([[FUTURE], [PAST]])('Received + %s target → DROP', (target) => {
    expect(upcoming(target, { status: 'Received' })).toHaveLength(0);
  });

  it('★★★ SUPERSEDED BY fix-499 — an open waiting_on task no longer makes a row overdue', () => {
    // ★★★ fix-269's rule was `transmitState === 'open'`. The predicate reads
    //     the ROUND now and takes no task at all: a task cannot reach it.
    expect(vendorRowIsOverdue(PAST_TARGET_SEND, 'Scheduled', TODAY)).toBe(true);
    expect(vendorRowIsOverdue(PAST_TARGET_SEND, 'Pending', TODAY)).toBe(false);
    expect(vendorRowIsOverdue(PAST_TARGET_SEND, 'Received', TODAY)).toBe(false);
    expect(vendorRowIsOverdue(PAST_TARGET_SEND, null, TODAY)).toBe(false);
    // A sent package cannot be late to be sent.
    expect(vendorRowIsOverdue(FUTURE_TARGET_SEND, 'Scheduled', TODAY)).toBe(false);
    expect(vendorRowIsOverdue(null, 'Scheduled', TODAY)).toBe(false);
  });

  // ---- interactions ----

  it('all-permits-done OVERRIDES a live round', () => {
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: PAST, end_week: null })],
      projects: [withSss],
      consultants: rounds(consultant({ project_id: 'p1' })),
      allPermitsDoneIds: new Set(['p1']),
    });
    expect(rows).toHaveLength(0);
  });

  it('OVERDUE rows sort ahead of on-time rows', () => {
    const late = project({ id: 'late', address: 'ZZZ Late St' } as Partial<Project> & { id: string });
    const ontime = project({ id: 'ontime', address: 'AAA Early St' } as Partial<Project> & { id: string });
    const rows = build({
      // The overdue row has both a LATER start week and an alphabetically later
      // address, so only the overdue rule can put it first.
      draw: [
        block({ project_id: 'ontime', start_week: '2026-08-01', dd_end: FUTURE, end_week: null }),
        block({ project_id: 'late', start_week: '2026-09-01', dd_end: PAST, end_week: null }),
      ],
      projects: [late, ontime],
    });
    expect(rows.map((r) => r.projectId)).toEqual(['late', 'ontime']);
    expect(rows[0].overdue).toBe(true);
  });

  it('the end_week fallback still supplies the target send', () => {
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: null, end_week: PAST })],
      projects: [withSss],
    });
    expect(rows[0].overdue).toBe(true);
    expect(rows[0].targetSend).toBe(PAST_TARGET_SEND);
  });

  it('a voided round never reaches this module at all', () => {
    // ★ `project_consultant_current` filters `voided_at IS NULL` in SQL and
    //   picks the highest live round_index (fix-479). The report reads that
    //   view, so a voided round cannot be the current one — the rule is the
    //   database's and is not re-implemented here.
    expect(build({ draw: [block({ project_id: 'p1' })], projects: [withSss], consultants: rounds() })).toHaveLength(0);
  });
});

// fix-271: the PROJECT'S PHASE decides design-vs-permitting, not the task's name.
//
// fix-268 matched task TEXT against a list. Four naming variants exist in the
// wild and the list misfiled two projects — 7336 132nd Ave NE and 7708 131st Ave
// NE, both pre-submittal with tasks named plainly "Structural", both landing in
// CORRECTIONS as permitting work on projects never submitted. Neither has a
// permit number. Bobby: "corrections are for projects within permitting phase,
// not the design phase/cycle."
describe('fix-271 phase decides transmit vs corrections', () => {
  const withSss = project({
    id: 'p1',
    address: '7708 131st Ave NE',
    juris: 'Kirkland',
    external_team: { Structural: 'SSS' },
  } as Partial<Project> & { id: string });

  // ★★★ fix-499: THIS DESCRIBE IS STILL THE POINT, and section 5 is untouched.
  //     A correction is post-submittal permitting work sitting with the firm —
  //     it is not a design round, has no round to belong to, and still comes
  //     from tasks. fix-271's rule that the PROJECT'S PHASE decides, not the
  //     task's name, survives this ticket intact.
  //
  // ★★ What changed here is only the other side of the fork: `transmitted` and
  //    `state` used to be read off the same tasks. TRANSMITTED reads rounds
  //    now, so the fixture supplies one, and the design-phase half of each
  //    assertion becomes "not a correction" — which is what fix-271 was ever
  //    really asserting.
  function split(status: string | null, over: Partial<WaitingOnTaskRow> = {}) {
    const draw = status === null ? [] : [block({ project_id: 'p1', status })];
    const designIds = designPhaseProjectIds(draw);
    const tasks = [
      task({
        task_id: 't1',
        project_id: 'p1',
        task_text: 'Structural',
        start_date: null,
        completion_status: 'Open',
        ...over,
      }),
    ];
    const map = rounds(
      consultant({
        project_id: 'p1',
        status: over.start_date ? 'Pending' : 'Scheduled',
        sent: over.start_date ?? null,
      }),
    );
    return {
      designIds,
      transmitted: buildVendorTransmitRows(map, [withSss]),
      corrections: buildVendorCorrectionRows(
        tasks,
        [withSss],
        'Structural',
        designIds,
        undefined,
        map,
      ),
    };
  }

  // ---- THE BUG THIS FIXES ----

  it('THE 7708 SHAPE: a task named "Structural" on a pre-submittal project is DESIGN, not a correction', () => {
    const s = split('DD / Permit Set');
    expect(s.corrections).toHaveLength(0);
  });

  it('THE 7336 SHAPE: a pre-submittal project whose round is Pending is TRANSMITTED', () => {
    const s = split('Pending Consultants', { start_date: '2026-06-30' });
    expect(s.transmitted.map((r) => r.projectId)).toEqual(['p1']);
    expect(s.corrections).toHaveLength(0);
  });

  it('a Received round removes the project from BOTH sections', () => {
    const s = {
      transmitted: buildVendorTransmitRows(
        rounds(consultant({ project_id: 'p1', status: 'Received' })),
        [withSss],
      ),
      corrections: buildVendorCorrectionRows(
        [task({ task_id: 't1', project_id: 'p1', task_text: 'Structural' })],
        [withSss],
        'Structural',
        designPhaseProjectIds([block({ project_id: 'p1', status: 'Pending Consultants' })]),
      ),
    };
    expect(s.transmitted).toHaveLength(0);
    expect(s.corrections).toHaveLength(0);
  });

  // ---- TEXT IS IRRELEVANT ON BOTH SIDES ----

  it.each([
    ['Structural'],
    ['Structural - Transmitted'],
    ['Sent to Structural'],
    ['Structural CR1'],
    ['literally anything a DA types'],
  ])('%s on a PRE-SUBMITTAL project is design, whatever it is called', (text) => {
    const s = split('Scheduled', { task_text: text, start_date: '2026-06-30' });
    expect(s.transmitted.map((r) => r.projectId)).toEqual(['p1']);
    expect(s.corrections).toHaveLength(0);
  });

  it.each([
    ['Structural'],
    ['Structural - Transmitted'], // the old template text — now a correction here
    ['Sent to Structural'],
    ['Structural CR1'],
    ['literally anything a DA types'],
  ])('%s on a POST-SUBMITTAL project is a correction, whatever it is called', (text) => {
    const s = split('Under Review', { task_text: text, start_date: '2026-06-30' });
    expect(s.corrections.map((r) => r.taskId)).toEqual(['t1']);
  });

  it.each([['Under Review'], ['Corrections'], ['Approved'], ['Submitted']])(
    'post-submittal status %s puts structural work in corrections',
    (status) => {
      expect(split(status).corrections).toHaveLength(1);
    },
  );

  it.each([['Scheduled'], ['Schematic'], ['DD / Permit Set'], ['Pending Consultants']])(
    'pre-submittal status %s keeps structural work on the design side',
    (status) => {
      expect(split(status).corrections).toHaveLength(0);
    },
  );

  // ---- EDGES ----

  it('NO DRAW BLOCK → corrections', () => {
    // No design phase we can see. An over-listed correction is noise; an
    // invented "coming to you" commitment is worse.
    const s = split(null);
    expect(s.corrections.map((r) => r.taskId)).toEqual(['t1']);
    expect(s.transmitted).toHaveLength(0);
  });

  it('a BLANK status counts as design, matching the fix-266 pipeline rule', () => {
    const s = split('   ');
    expect(s.corrections).toHaveLength(0);
  });

  it('designPhaseProjectIds is exactly the pre-submittal set', () => {
    const ids = designPhaseProjectIds([
      block({ project_id: 'a', status: 'Scheduled' }),
      block({ project_id: 'b', status: 'Schematic' }),
      block({ project_id: 'c', status: 'DD / Permit Set' }),
      block({ project_id: 'd', status: 'Pending Consultants' }),
      block({ project_id: 'e', status: null }),
      block({ project_id: 'f', status: 'Under Review' }),
      block({ project_id: 'g', status: 'Corrections' }),
      block({ project_id: 'h', status: 'Approved' }),
    ]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('corrections rows carry the permit type and NOT the task text', () => {
    const s = split('Under Review', {
      task_text: 'Pending SSS Backgrounds',
      permit_type: 'PPR',
    });
    const row = s.corrections[0];
    expect(row.permit).toBe('PPR');
    expect(row.juris).toBe('Kirkland');
    // The task text is gone from the row shape entirely — it is the string we
    // stopped trusting, and noise to a vendor.
    expect(JSON.stringify(row)).not.toContain('Pending SSS Backgrounds');
    expect(row).not.toHaveProperty('need');
  });
});

// ★★★ fix-499: `describe('fix-269 transmit task is the liveness signal')` LIVED
//     HERE. Every case it covered is re-homed in the two fix-499 describes
//     above, asked of the consultant round instead of a permit task — including
//     its `transmitStateByProject` precedence block, which has nothing left to
//     rank now that a project has exactly one current round per discipline.
//
// ★★ The one case that did NOT survive intact is named as superseded up there
//    rather than quietly dropped: `none + PAST target → DROP`.
// fix-268: draw status goes stale. If the permits issued, structural finished
// long ago whatever the block still says.
describe('fix-268 issued permits leave the pipeline', () => {
  function permit(over: Record<string, unknown>) {
    return {
      project_id: 'p1',
      actual_issue: null,
      status: 'Reviews In Process',
      parent_permit_id: null,
      ...over,
    } as never;
  }

  it('all non-sub permits done â†’ project id returned', () => {
    const ids = allPermitsDoneProjectIds([
      permit({ project_id: 'p1', actual_issue: '2026-05-22', status: 'Completed' }),
    ]);
    expect([...ids]).toEqual(['p1']);
  });

  it('one open permit keeps the project OUT of the done set', () => {
    // 5811 Greenwood: Demo/PAR/SDOT issued but the Building Permit is still in
    // review. A demolition permit issuing says nothing about structural.
    const ids = allPermitsDoneProjectIds([
      permit({ project_id: 'p1', actual_issue: '2026-06-09', status: 'Issued' }),
      permit({ project_id: 'p1', actual_issue: null, status: 'Reviews In Process' }),
    ]);
    expect(ids.size).toBe(0);
  });

  it('sub-permits do not count — an open sub cannot keep a finished project in', () => {
    const ids = allPermitsDoneProjectIds([
      permit({ project_id: 'p1', actual_issue: '2026-05-22', status: 'Completed' }),
      permit({ project_id: 'p1', actual_issue: null, parent_permit_id: 7 }),
    ]);
    expect([...ids]).toEqual(['p1']);
  });

  it('a project with NO permits is not "done" (vacuous-truth trap)', () => {
    expect(allPermitsDoneProjectIds([]).size).toBe(0);
  });

  it('an all-issued project is dropped from the pipeline', () => {
    const rows = build({
      draw: [block({ project_id: 'p1' }), block({ project_id: 'p2' })],
      projects: [project({ id: 'p1' }), project({ id: 'p2' })],
      allPermitsDoneIds: new Set(['p1']),
    });
    expect(rows.map((r) => r.projectId)).toEqual(['p2']);
  });
});

// fix-268: dd_end is NULL on most blocks, so nothing caught a stale block whose
// scheduled window had long since elapsed.
// fix-268: dd_end is NULL on most blocks, so end_week is the fallback ANCHOR.
//
// ★★★ fix-499 MOVED WHAT THE DATE DECIDES, not how it is derived. These cases
//     asserted `drawBlockIsVendorVisible` returning false for a passed date;
//     that function no longer asks a date question at all. The fallback itself
//     is untouched — one rule, both sources — and it now decides the TARGET
//     SEND shown and the OVERDUE flag rather than membership.
describe('fix-268 end_week fallback', () => {
  const p = project({ id: 'p1' });

  function row(dd_end: string | null, end_week: string | null) {
    return build({
      draw: [block({ project_id: 'p1', dd_end, end_week })],
      projects: [p],
    })[0];
  }

  it('★★★ SUPERSEDED: dd_end NULL + PAST end_week is KEPT and flagged, was excluded', () => {
    const r = row(null, '2026-06-08');
    expect(r.projectId).toBe('p1');
    expect(r.overdue).toBe(true);
    // The fallback anchor, minus the one-week send lead (fix-309 #48).
    expect(r.targetSend).toBe('2026-06-01');
  });

  it('dd_end NULL + FUTURE end_week → kept, on time, dated off end_week', () => {
    const r = row(null, '2026-09-14');
    expect(r.overdue).toBe(false);
    expect(r.targetSend).toBe('2026-09-07');
  });

  it('★★★ SUPERSEDED: dd_end NULL + no end_week either is now ABSENT, was kept', () => {
    // ★★ fix-499's no-date rule. Membership used to come from the block, so an
    //    undated block was still a row with a blank commitment. Membership comes
    //    from the round now, and a row with no date at all is an invented
    //    commitment in a list an outside engineer reads.
    expect(
      build({ draw: [block({ project_id: 'p1', dd_end: null, end_week: null })], projects: [p] }),
    ).toHaveLength(0);
  });

  it('dd_end PRESENT → the fallback does NOT fire', () => {
    // dd_end is primary and where it exists end_week is never consulted.
    expect(row('2026-09-18', '2025-01-01').targetSend).toBe('2026-09-11');
    expect(row('2026-08-02', '2027-01-01').targetSend).toBe('2026-07-26');
  });
});

describe('fix-265 inclusion rule', () => {
  const p = project({ id: 'p1' });

  it('includes a plain scheduled block with an address', () => {
    expect(drawBlockIsVendorVisible(block({ project_id: 'p1' }), p, new Set())).toBe(true);
  });

  it('excludes design-phase Corrections blocks — already visible on the schedule', () => {
    expect(
      drawBlockIsVendorVisible(
        block({ project_id: 'p1', status: 'Corrections' }),
        p,
        new Set(),
      ),
    ).toBe(false);
  });

  it('excludes a block opted out via exclude_from_vendor_reports', () => {
    expect(
      drawBlockIsVendorVisible(
        { ...block({ project_id: 'p1' }), exclude_from_vendor_reports: true },
        p,
        new Set(),
      ),
    ).toBe(false);
  });

  it('excludes CANCELLED projects (fix-264 rule)', () => {
    expect(
      drawBlockIsVendorVisible(block({ project_id: 'p1' }), p, new Set(['p1'])),
    ).toBe(false);
  });

  it('★★★ SUPERSEDED BY fix-499: a past DD end no longer excludes — it flags', () => {
    expect(
      drawBlockIsVendorVisible(block({ project_id: 'p1', dd_end: '2026-08-02' }), p, new Set()),
    ).toBe(true);
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: '2026-08-02', end_week: null })],
      projects: [p],
    });
    expect(rows[0].overdue).toBe(true);
  });

  it('KEEPS a block with no DD end — a blank is not a reason to hide work', () => {
    // dd_end is NULL on 84 of 124 prod rows. Dropping those would hide most of
    // the pipeline from the vendor; the blank cell prompts the data entry.
    // ★ end_week still supplies the anchor here, so the row survives fix-499's
    //   no-date rule.
    expect(
      drawBlockIsVendorVisible(block({ project_id: 'p1', dd_end: null }), p, new Set()),
    ).toBe(true);
    expect(
      build({ draw: [block({ project_id: 'p1', dd_end: null })], projects: [p] }),
    ).toHaveLength(1);
  });

  it('excludes a block whose project is missing or address-less', () => {
    // Non-project blocks (Vacation / PTO / training / the OOO floater) live in a
    // SEPARATE table, da_time_blocks, and never reach draw_schedule at all — all
    // 124 prod draw rows resolve to a project. This is the defensive backstop.
    expect(drawBlockIsVendorVisible(block({ project_id: 'ghost' }), undefined, new Set())).toBe(false);
    expect(
      drawBlockIsVendorVisible(
        block({ project_id: 'p1' }),
        project({ id: 'p1', address: '   ' }),
        new Set(),
      ),
    ).toBe(false);
  });

  it('a HELD project stays IN, and carries its hold reason', () => {
    const holds = new Map<string, ProjectHold>([
      ['p1', { reason: 'Waiting on survey' } as ProjectHold],
    ]);
    const rows = build({ draw: [block({ project_id: 'p1' })], projects: [p], holdsByProject: holds });
    expect(rows).toHaveLength(1);
    expect(rows[0].holdReason).toBe('Waiting on survey');
  });
});

describe('fix-265 bucketing against the ledger', () => {
  const p1 = project({ id: 'p1', address: '100 A St' });
  const p2 = project({ id: 'p2', address: '200 B St' });
  const p3 = project({ id: 'p3', address: '300 C St' });

  it('no ledger row â†’ NEW', () => {
    const rows = build({ draw: [block({ project_id: 'p1' })], projects: [p1] });
    expect(rows[0].bucket).toBe('new');
    expect(rows[0].previous).toBeNull();
  });

  it('identical ledger row â†’ UNCHANGED, with no previous', () => {
    const rows = build({
      draw: [block({ project_id: 'p1' })],
      projects: [p1],
      ledger: [ledger({ project_id: 'p1' })],
    });
    expect(rows[0].bucket).toBe('unchanged');
    expect(rows[0].previous).toBeNull();
  });

  it.each([
    ['start week', { sent_start_week: '2026-07-06' }],
    ['DD end', { sent_dd_end: '2026-08-21' }],
    ['status', { sent_status: 'Pending Consultants' }],
  ])('a moved %s â†’ CHANGED, carrying the old value', (_label, patch) => {
    const rows = build({
      draw: [block({ project_id: 'p1' })],
      projects: [p1],
      ledger: [ledger({ project_id: 'p1', ...patch })],
    });
    expect(rows[0].bucket).toBe('changed');
    expect(rows[0].previous).not.toBeNull();
  });

  it('carries BOTH old and new so the delta can be rendered', () => {
    const rows = build({
      draw: [block({ project_id: 'p1', start_week: '2026-08-17' })],
      projects: [p1],
      ledger: [ledger({ project_id: 'p1', sent_start_week: '2026-08-10' })],
    });
    expect(rows[0].previous?.startWeek).toBe('2026-08-10');
    expect(rows[0].startWeek).toBe('2026-08-17');
  });

  it('blank and NULL compare equal — an untouched row never reads as changed', () => {
    // ★★★ fix-499 RE-AIMED THIS TEST, and the reason is the ticket. It used to
    //     blank BOTH dd_end and end_week and assert the row was `unchanged`
    //     with a blank target send. A row with no date at all is now ABSENT —
    //     an undated commitment is the one thing this report must not print —
    //     so a blank target send is unreachable, and the blank-vs-null rule is
    //     asserted on the two facts that can still be blank.
    const rows = build({
      draw: [block({ project_id: 'p1', start_week: null, status: null })],
      projects: [p1],
      ledger: [
        ledger({ project_id: 'p1', sent_start_week: '', sent_status: '' }),
      ],
    });
    expect(rows[0].bucket).toBe('unchanged');
    expect(rows[0].previous).toBeNull();
  });

  it('fix-269: the ledger tracks the TARGET SEND, so an end_week move is a change', () => {
    // The ledger must hold whatever the vendor was SHOWN. If it tracked raw
    // dd_end while the email showed the end_week fallback, a project whose
    // end_week moved would display a new target send that was never flagged —
    // and Changes exists precisely to catch that movement.
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: null, end_week: '2026-10-05' })],
      projects: [p1],
      ledger: [ledger({ project_id: 'p1', sent_dd_end: '2026-09-14' })],
    });
    // fix-309 #48: end_week 2026-10-05 -> target send a week earlier.
    expect(rows[0].targetSend).toBe('2026-09-28');
    expect(rows[0].bucket).toBe('changed');
    expect(rows[0].previous?.targetSend).toBe('2026-09-14');
  });

  it('fix-269: the send payload records the target send, not raw dd_end', () => {
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: null, end_week: '2026-10-05' })],
      projects: [p1],
    });
    // The ledger records what the vendor was TOLD, which is the shifted date.
    expect(vendorSentPayload(rows)[0].dd_end).toBe('2026-09-28');
  });

  it('blank â†’ a value IS a change (the vendor learns a date they did not have)', () => {
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: '2026-09-18' })],
      projects: [p1],
      ledger: [ledger({ project_id: 'p1', sent_dd_end: null })],
    });
    expect(rows[0].bucket).toBe('changed');
    expect(rows[0].previous?.targetSend).toBeNull();
  });

  it('sorts by start week, then address', () => {
    const rows = build({
      draw: [
        block({ project_id: 'p3', start_week: '2026-09-07' }),
        block({ project_id: 'p2', start_week: '2026-08-10' }),
        block({ project_id: 'p1', start_week: '2026-08-10' }),
      ],
      projects: [p1, p2, p3],
    });
    expect(rows.map((r) => r.address)).toEqual(['100 A St', '200 B St', '300 C St']);
  });
});

describe('fix-265 sections — the RUNNING LIST rule', () => {
  const p1 = project({ id: 'p1', address: '100 A St' });
  const p2 = project({ id: 'p2', address: '200 B St' });
  const p3 = project({ id: 'p3', address: '300 C St' });

  const rows = build({
    draw: [
      block({ project_id: 'p1' }), // never sent      â†’ new
      block({ project_id: 'p2', start_week: '2026-08-17' }), // moved â†’ changed
      block({ project_id: 'p3' }), // sent, unchanged â†’ pipeline only
    ],
    projects: [p1, p2, p3],
    ledger: [
      ledger({ project_id: 'p2', sent_start_week: '2026-08-10' }),
      ledger({ project_id: 'p3' }),
    ],
  });
  const sections = splitVendorSections(rows);

  it('buckets new and changed off the ledger', () => {
    expect(sections.newRows.map((r) => r.projectId)).toEqual(['p1']);
    expect(sections.changedRows.map((r) => r.projectId)).toEqual(['p2']);
  });

  it('REGRESSION LOCK: the pipeline keeps rows already sent and unchanged', () => {
    // Bobby: "we want to keep the list a running list, that way nothing is
    // missed." The ledger decides what is NEW or CHANGED; it must never decide
    // what is VISIBLE. Filtering this by bucket would look like a tidy-up and
    // would silently reintroduce the failure this feature exists to fix.
    expect(sections.pipelineRows.map((r) => r.projectId).sort()).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
    expect(sections.pipelineRows.some((r) => r.bucket === 'unchanged')).toBe(true);
  });

  it('the send payload is the whole pipeline, not just new + changed', () => {
    // After a send the vendor knows the CURRENT state of everything on the list.
    const payload = vendorSentPayload(sections.pipelineRows);
    expect(payload.map((r) => r.project_id).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(payload[0]).toHaveProperty('start_week');
    expect(payload[0]).toHaveProperty('dd_end');
    expect(payload[0]).toHaveProperty('status');
  });
});

describe('fix-265 send cycle', () => {
  const p1 = project({ id: 'p1', address: '100 A St' });
  const draw = [block({ project_id: 'p1', start_week: '2026-08-10' })];

  /** Simulate bp_mark_vendor_report_sent: upsert the payload into the ledger. */
  function markSent(prev: VendorLedgerRow[], rows: ReturnType<typeof vendorSentPayload>, at: string) {
    const byId = new Map(prev.map((l) => [l.project_id, l]));
    for (const r of rows) {
      byId.set(r.project_id, {
        project_id: r.project_id,
        sent_start_week: r.start_week,
        sent_dd_end: r.dd_end,
        sent_status: r.status,
        sent_at: at,
      });
    }
    return [...byId.values()];
  }

  it('a second immediate run yields an empty new/changed set', () => {
    let state: VendorLedgerRow[] = [];
    const first = splitVendorSections(build({ draw, projects: [p1], ledger: state }));
    expect(first.newRows).toHaveLength(1);

    state = markSent(state, vendorSentPayload(first.pipelineRows), '2026-08-03T17:00:00Z');

    const second = splitVendorSections(build({ draw, projects: [p1], ledger: state }));
    expect(second.newRows).toHaveLength(0);
    expect(second.changedRows).toHaveLength(0);
    // ...but the row is still on the running list.
    expect(second.pipelineRows).toHaveLength(1);
  });

  it('a SKIPPED week accumulates both moves instead of losing the first', () => {
    // Week 0: send the original date.
    let state = markSent(
      [],
      vendorSentPayload(
        splitVendorSections(build({ draw, projects: [p1] })).pipelineRows,
      ),
      '2026-07-20T17:00:00Z',
    );

    // Week 1: it moves — but nobody sends the email that week.
    const wk1 = [block({ project_id: 'p1', start_week: '2026-08-17' })];
    const skipped = splitVendorSections(build({ draw: wk1, projects: [p1], ledger: state }));
    expect(skipped.changedRows).toHaveLength(1);

    // Week 2: it moves AGAIN. Because the ledger still holds the last COMMUNICATED
    // value (not last week's computed value), the delta shown is the full move
    // from what the vendor actually knows — the week-1 change is not lost.
    const wk2 = [block({ project_id: 'p1', start_week: '2026-08-24' })];
    const caught = splitVendorSections(build({ draw: wk2, projects: [p1], ledger: state }));
    expect(caught.changedRows).toHaveLength(1);
    expect(caught.changedRows[0].previous?.startWeek).toBe('2026-08-10');
    expect(caught.changedRows[0].startWeek).toBe('2026-08-24');

    // And once it IS sent, the ledger catches up.
    state = markSent(state, vendorSentPayload(caught.pipelineRows), '2026-08-03T17:00:00Z');
    expect(
      splitVendorSections(build({ draw: wk2, projects: [p1], ledger: state })).changedRows,
    ).toHaveLength(0);
  });

  it('lastSentAt is the max sent_at across the ledger', () => {
    expect(
      lastSentAt([
        ledger({ project_id: 'a', sent_at: '2026-07-20T17:00:00Z' }),
        ledger({ project_id: 'b', sent_at: '2026-08-03T17:00:00Z' }),
      ]),
    ).toBe('2026-08-03T17:00:00Z');
    expect(lastSentAt([])).toBeNull();
  });
});

// ★★★ fix-499 §C: `describe('fix-265 reuse columns')` LIVED HERE, asserting the
//     row carried `reuseFromAddress` and `reuseNotes`. Bobby, 2026-08-31:
//     *"There's not going to be any notes. It's like, here's your dates, here's
//     your address, here's your unit, here's your unit type."* The Reuse column
//     went, and with it the two fields, the hook that fetched them
//     (`useVendorReportExtras` — nothing else read it) and its query key.
describe('fix-499 §C: the row is five columns and nothing else', () => {
  it('★★★ SUPERSEDED: the row no longer carries reuse at all', () => {
    const source = project({ id: 'src', address: '13515 27th Ave NE' });
    const p = project({
      id: 'p1',
      address: '100 A St',
      reused_from_project_id: 'src',
      reuse_notes: 'W/O GAR',
    });
    const rows = build({ draw: [block({ project_id: 'p1' })], projects: [p, source] });
    // ★ The project still HAS the columns — this ticket dropped the report's
    //   use of them, not the data. What changed is what the firm is shown.
    expect(rows[0]).not.toHaveProperty('reuseFromAddress');
    expect(rows[0]).not.toHaveProperty('reuseNotes');
    expect(JSON.stringify(rows[0])).not.toContain('W/O GAR');
    expect(JSON.stringify(rows[0])).not.toContain('13515 27th Ave NE');
  });

  it('★★ and it carries the five it is meant to', () => {
    const rows = build({
      draw: [block({ project_id: 'p1' })],
      projects: [
        project({
          id: 'p1',
          address: '100 A St',
          units: 4,
          product_types: ['SFR'],
        } as Partial<Project> & { id: string }),
      ],
      consultants: rounds(consultant({ project_id: 'p1', est_recd: '2026-10-02' })),
    });
    const r = rows[0];
    expect(r.address).toBe('100 A St');
    expect(r.units).toBe(4);
    expect(r.productTypes).toEqual(['SFR']);
    expect(r.targetSend).toBe('2026-09-11');
    expect(r.expectedBack).toBe('2026-10-02');
  });
});

// ---------------------------------------------------------------------------
// ★★★ fix-499 §B — the discipline parameter
// ---------------------------------------------------------------------------
describe('fix-499 §B: the discipline is a parameter', () => {
  it('★★★ ABSENT means Structural, so every old link lands where it did', () => {
    expect(resolveForecastDiscipline(null)).toBe('Structural');
    expect(resolveForecastDiscipline(undefined)).toBe('Structural');
    expect(resolveForecastDiscipline('')).toBe('Structural');
    expect(resolveForecastDiscipline('   ')).toBe('Structural');
  });

  it('★★ all seven directory disciplines resolve, case-insensitively', () => {
    for (const d of ['Structural', 'Civil', 'Surveyor', 'Arborist', 'Geotech', 'Energy', 'Landscape']) {
      expect(resolveForecastDiscipline(d)).toBe(d);
      expect(resolveForecastDiscipline(d.toLowerCase())).toBe(d);
    }
  });

  it('★★★ an UNKNOWN value is null — the page renders an empty state, never a throw', () => {
    expect(resolveForecastDiscipline('Plumbing')).toBeNull();
    expect(resolveForecastDiscipline('structual')).toBeNull();
  });

  it('★★★ the ledger key is the lower-cased discipline — structural KEEPS its 6 rows', () => {
    // ★★ vendor_report_state is keyed by vendor_key and holds 6 rows, all
    //    `structural`. If this returned anything else those rows would be
    //    orphaned and every project would read as NEW on the next run.
    expect(vendorKeyForDiscipline('Structural')).toBe('structural');
    expect(vendorKeyForDiscipline('Civil')).toBe('civil');
    expect(vendorKeyForDiscipline(' Surveyor ')).toBe('surveyor');
  });

  it('★★ consultantByProject keeps one row per project and ignores other disciplines', () => {
    const map = consultantByProject(
      [
        consultant({ project_id: 'p1', discipline: 'Structural' }),
        consultant({ project_id: 'p2', discipline: 'Civil' }),
        consultant({ project_id: 'p3', discipline: 'Structural' }),
      ],
      'Structural',
    );
    expect([...map.keys()].sort()).toEqual(['p1', 'p3']);
  });
});

// ---------------------------------------------------------------------------
// Section 4 — corrections with the vendor
// ---------------------------------------------------------------------------

function task(over: Partial<WaitingOnTaskRow> & { task_id: string }): WaitingOnTaskRow {
  return {
    task_text: 'Structural backgrounds',
    bucket: 'pm',
    waiting_on: 'Structural',
    firm_id: null,
    firm_name: null,
    firm_active: true,
    project_id: 'p1',
    project_address: '100 A St',
    project_juris: 'Seattle',
    permit_id: 1,
    permit_type: 'Building Permit',
    assigned_to: null,
    priority: false,
    start_date: '2026-07-27',
    due_date: null,
    target_date: '2026-08-14',
    completion_status: 'Open',
    done: false,
    done_at: null,
    notes: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...over,
  } as WaitingOnTaskRow;
}

describe('fix-265 corrections section', () => {
  const withSss = project({
    id: 'p1',
    address: '100 A St',
    external_team: { Structural: 'SSS' },
  } as Partial<Project> & { id: string });
  const withOther = project({
    id: 'p2',
    address: '200 B St',
    external_team: { Structural: 'Other Engineers' },
  } as Partial<Project> & { id: string });
  const withNoFirm = project({ id: 'p3', address: '300 C St' });

  /** fix-271: these projects are all POST-submittal (no design set membership),
   *  so their structural tasks are corrections regardless of what they read. */
  const NO_DESIGN: ReadonlySet<string> = new Set<string>();

  // ★★ fix-499: the firm this discipline's work belongs to comes from the
  //    CONSULTANT RECORDS now, not from a `VENDOR_FIRM` constant. The fixture
  //    therefore has to say which firm Structural means — and once it does,
  //    every assertion below holds exactly as it did.
  const STRUCTURAL_RECORDS = rounds(
    consultant({ project_id: 'p1', firm_name: 'SSS' }),
  );

  function rowsFor(tasks: WaitingOnTaskRow[], cancelled?: Set<string>) {
    return buildVendorCorrectionRows(
      tasks,
      [withSss, withOther, withNoFirm],
      'Structural',
      NO_DESIGN,
      cancelled,
      STRUCTURAL_RECORDS,
    );
  }

  it('includes a live task whose project names this vendor', () => {
    const rows = rowsFor([task({ task_id: 't1', project_id: 'p1' })]);
    expect(rows.map((r) => r.taskId)).toEqual(['t1']);
    expect(rows[0].firm).toBe('SSS');
  });

  it.each([['Resolved'], ['Cancelled']])('excludes %s tasks', (status) => {
    expect(
      rowsFor([task({ task_id: 't1', project_id: 'p1', completion_status: status })]),
    ).toHaveLength(0);
  });

  it('excludes a task waiting on a DIFFERENT discipline', () => {
    expect(
      rowsFor([task({ task_id: 't1', project_id: 'p1', waiting_on: 'Surveyor' })]),
    ).toHaveLength(0);
  });

  it('excludes a task whose project names a DIFFERENT structural firm', () => {
    expect(rowsFor([task({ task_id: 't1', project_id: 'p2' })])).toHaveLength(0);
  });

  it('INCLUDES a task whose project has no structural firm recorded', () => {
    // Measured on prod: 4 live Structural tasks, only 2 whose project records a
    // firm. A strict match drops two whose text literally reads "Pending SSS" /
    // "Pending SSS Backgrounds". The fallback only ever fires when the firm is
    // UNRECORDED, so it can never mis-attribute to a known-different firm, and
    // the blank firm is surfaced so the data gets filled in.
    const rows = rowsFor([task({ task_id: 't1', project_id: 'p3' })]);
    expect(rows.map((r) => r.taskId)).toEqual(['t1']);
    expect(rows[0].firm).toBeNull();
  });

  it('excludes tasks on a cancelled project', () => {
    expect(rowsFor([task({ task_id: 't1', project_id: 'p1' })], new Set(['p1']))).toHaveLength(0);
  });

  it('KEEPS a row with missing dates, blank rather than dropped', () => {
    const rows = rowsFor([
      task({ task_id: 't1', project_id: 'p1', start_date: null, target_date: null }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sent).toBeNull();
    expect(rows[0].expectedBack).toBeNull();
  });

  it('uses target_date as "expected back" and ignores due_date entirely', () => {
    // due_date is unset on every waiting-on task on prod; a second date concept
    // in a vendor-facing email would only confuse the engineer.
    const rows = rowsFor([
      task({
        task_id: 't1',
        project_id: 'p1',
        target_date: '2026-08-14',
        due_date: '2026-12-25',
      }),
    ]);
    expect(rows[0].expectedBack).toBe('2026-08-14');
    expect(JSON.stringify(rows[0])).not.toContain('2026-12-25');
  });
});



// ===========================================================================
// fix-309 #48 — the consultant email was a week late.
// ===========================================================================

describe('fix-309 #48: target send is a week BEFORE the end of DD', () => {
  it('★ derives dd_end minus 7 days', () => {
    // "We don't send our backgrounds out at the end of the DD phase, we send
    // them out roughly a week before the end of the DD phase."
    expect(vendorTargetSend({ dd_end: '2026-08-21', end_week: null })).toBe('2026-08-14');
  });

  it('the end_week fallback shifts too — one rule, both sources', () => {
    // 84 of 139 blocks have no dd_end. Leaving the fallback unshifted would
    // keep the old, late date under a different name.
    expect(vendorTargetSend({ dd_end: null, end_week: '2026-08-21' })).toBe('2026-08-14');
  });

  it('no anchor still means no target send', () => {
    expect(vendorTargetSend({ dd_end: null, end_week: null })).toBeNull();
  });

  it('★ a project whose DD ends NEXT week now sends THIS week', () => {
    // The brief's sanity check, on the real shape of 548 3rd Ave N: dd_end
    // 2026-08-21, so with today 2026-08-14 the target send is today — inside
    // this week, where before it fell in the next one.
    const target = vendorTargetSend({ dd_end: '2026-08-21', end_week: null })!;
    const today = '2026-08-14';
    const endOfThisWeek = '2026-08-20';
    expect(target >= today && target <= endOfThisWeek).toBe(true);
    // …and under the old rule it did not.
    expect('2026-08-21' <= endOfThisWeek).toBe(false);
  });

  it('crossing a month boundary stays a valid ISO date', () => {
    expect(vendorTargetSend({ dd_end: '2026-09-03', end_week: null })).toBe('2026-08-27');
    expect(vendorTargetSend({ dd_end: '2026-01-05', end_week: null })).toBe('2025-12-29');
  });
});
