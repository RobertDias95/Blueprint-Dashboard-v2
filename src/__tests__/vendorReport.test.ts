import { describe, it, expect } from 'vitest';
import {
  VENDOR_KEY_STRUCTURAL,
  VENDOR_PIPELINE_STATUSES,
  buildVendorTransmitRows,
  transmitStateByProject,
  designPhaseProjectIds,
  allPermitsDoneProjectIds,
  type TransmitState,
  buildVendorScheduleRows,
  splitVendorSections,
  buildVendorCorrectionRows,
  drawBlockIsVendorVisible,
  vendorSentPayload,
  lastSentAt,
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
// detection against the ledger, and (b) the running-list rule â€” that already-sent
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

function ledger(over: Partial<VendorLedgerRow> & { project_id: string }): VendorLedgerRow {
  return {
    sent_start_week: '2026-08-10',
    sent_dd_end: '2026-09-18',
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
  transmitState?: Map<string, TransmitState>;
}) {
  return buildVendorScheduleRows({
    draw: opts.draw,
    projects: opts.projects,
    ledger: opts.ledger ?? [],
    cancelledIds: opts.cancelledIds,
    holdsByProject: opts.holdsByProject,
    allPermitsDoneIds: opts.allPermitsDoneIds,
    transmitState: opts.transmitState,
    todayIso: TODAY,
  });
}

// fix-266: the pipeline is a PHASE question, not a date question. Structural's
// involvement ends when the drawings go to the city, so only pre-submittal
// statuses belong. Before this, the pipeline rendered 66 prod rows of which 39
// were finished Approved work (oldest start 2025-02-10) â€” the dd_end filter
// could not fire because dd_end is NULL on 84 of 124 blocks.
describe('fix-266 pipeline is pre-submittal only', () => {
  const p = project({ id: 'p1' });

  function visible(status: string | null) {
    return drawBlockIsVendorVisible(
      block({ project_id: 'p1', status }),
      p,
      new Set(),
      TODAY,
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
    // goes out to a vendor â€” a new status is OUT until someone decides it is
    // pre-submittal.
    expect([...VENDOR_PIPELINE_STATUSES].sort()).toEqual([
      'DD / Permit Set',
      'Pending Consultants',
      'Scheduled',
      'Schematic',
    ]);
  });

  it('KEEPS a block with no status â€” we cannot prove it is past submittal', () => {
    // Same principle as the blank dd_end: silently dropping a project the vendor
    // needs to hear about is worse than one extra row. Zero prod rows today.
    expect(visible(null)).toBe(true);
    expect(visible('   ')).toBe(true);
  });

  it('keeps the dd_end gate as well â€” it still fires within an allowed status', () => {
    // fix-266 ADDS a gate, it does not replace one.
    expect(
      drawBlockIsVendorVisible(
        block({ project_id: 'p1', status: 'Scheduled', dd_end: '2026-08-02' }),
        p,
        new Set(),
        TODAY,
      ),
    ).toBe(false);
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
      VENDOR_KEY_STRUCTURAL,
      designPhaseProjectIds([block({ project_id: 'p1', status: 'Under Review' })]),
    );
    expect(corrections.map((r) => r.taskId)).toEqual(['t1']);
  });
});

// fix-268: the design-phase handoff. A project is "coming to you" (section 3) or
// "with you" (section 4), never both, and it leaves both when the transmit task
// is Resolved. Told apart from corrections by TASK TEXT, because permit_tasks has
// no template_id â€” verified on prod.
describe('fix-268 transmit task â‡„ pipeline', () => {
  const withSss = project({
    id: 'p1',
    address: '554 N 75th St',
    external_team: { Structural: 'SSS' },
  } as Partial<Project> & { id: string });

  function transmitTask(over: Partial<WaitingOnTaskRow> = {}) {
    return task({
      task_id: 't1',
      project_id: 'p1',
      task_text: 'Structural - Transmitted',
      start_date: null,
      target_date: null,
      completion_status: 'Open',
      ...over,
    });
  }

  /** fix-271: the block's status drives the design/permitting split, so the
   *  fixture builds the design set from the same block the pipeline sees. */
  function sections(tasks: WaitingOnTaskRow[], status = 'Scheduled') {
    const draw = [block({ project_id: 'p1', status })];
    const designIds = designPhaseProjectIds(draw);
    return {
      transmitted: buildVendorTransmitRows(
        tasks,
        [withSss],
        VENDOR_KEY_STRUCTURAL,
        designIds,
      ),
      pipeline: splitVendorSections(
        build({
          draw,
          projects: [withSss],
          transmitState: transmitStateByProject(
            tasks,
            [withSss],
            VENDOR_KEY_STRUCTURAL,
            designIds,
          ),
        }),
      ).pipelineRows,
      corrections: buildVendorCorrectionRows(
        tasks,
        [withSss],
        VENDOR_KEY_STRUCTURAL,
        designIds,
      ),
    };
  }

  it('NOT STARTED: project is in PIPELINE, not in TRANSMITTED', () => {
    // A transmit task that exists but has not started is not "with them" â€”
    // nothing was sent.
    const s = sections([transmitTask({ start_date: null })]);
    expect(s.transmitted).toHaveLength(0);
    expect(s.pipeline.map((r) => r.projectId)).toEqual(['p1']);
  });

  it('STARTED: in TRANSMITTED, ABSENT from PIPELINE', () => {
    const s = sections([
      transmitTask({ start_date: '2026-09-18', target_date: '2026-10-02' }),
    ]);
    expect(s.transmitted.map((r) => r.projectId)).toEqual(['p1']);
    expect(s.transmitted[0].sent).toBe('2026-09-18');
    expect(s.transmitted[0].expectedBack).toBe('2026-10-02');
    expect(s.pipeline).toHaveLength(0);
  });

  it('RESOLVED: in neither — received, so it leaves design-phase tracking', () => {
    // fix-269 changed this: under fix-268 a resolved transmit still sat in
    // UPCOMING. Resolved means received, so structural is finished with the
    // design phase and the project is not "coming to them" either.
    const s = sections([
      transmitTask({ start_date: '2026-09-18', completion_status: 'Resolved' }),
    ]);
    expect(s.transmitted).toHaveLength(0);
    expect(s.pipeline).toHaveLength(0);
    // ...and it is not a correction either.
    expect(s.corrections).toHaveLength(0);
  });

  it('a started transmit task never ALSO shows as a correction', () => {
    // Design phase and permitting phase never blur.
    const s = sections([transmitTask({ start_date: '2026-09-18' })]);
    expect(s.corrections).toHaveLength(0);
  });

  it('a transmit task on a project the vendor does not own is ignored', () => {
    const other = project({
      id: 'p1',
      address: '554 N 75th St',
      external_team: { Structural: 'Other Engineers' },
    } as Partial<Project> & { id: string });
    expect(
      buildVendorTransmitRows(
        [transmitTask({ start_date: '2026-09-18' })],
        [other],
        VENDOR_KEY_STRUCTURAL,
        new Set(['p1']),
      ),
    ).toHaveLength(0);
  });

  it('a transmit task on a CANCELLED project is ignored', () => {
    expect(
      buildVendorTransmitRows(
        [transmitTask({ start_date: '2026-09-18' })],
        [withSss],
        VENDOR_KEY_STRUCTURAL,
        new Set(['p1']),
        new Set(['p1']),
      ),
    ).toHaveLength(0);
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
    return {
      designIds,
      transmitted: buildVendorTransmitRows(tasks, [withSss], VENDOR_KEY_STRUCTURAL, designIds),
      corrections: buildVendorCorrectionRows(tasks, [withSss], VENDOR_KEY_STRUCTURAL, designIds),
      state: transmitStateByProject(tasks, [withSss], VENDOR_KEY_STRUCTURAL, designIds).get('p1'),
    };
  }

  // ---- THE BUG THIS FIXES ----

  it('THE 7708 SHAPE: a task named "Structural" on a pre-submittal project is DESIGN, not a correction', () => {
    const s = split('DD / Permit Set');
    expect(s.corrections).toHaveLength(0);
    expect(s.state).toBe('open'); // unstarted → stays in Upcoming
  });

  it('THE 7336 SHAPE: the same task, started, is TRANSMITTED', () => {
    const s = split('Pending Consultants', { start_date: '2026-06-30' });
    expect(s.transmitted.map((r) => r.taskId)).toEqual(['t1']);
    expect(s.corrections).toHaveLength(0);
    expect(s.state).toBe('started');
  });

  it('resolving it removes the project from BOTH sections', () => {
    const s = split('Pending Consultants', {
      start_date: '2026-06-30',
      completion_status: 'Resolved',
    });
    expect(s.transmitted).toHaveLength(0);
    expect(s.corrections).toHaveLength(0);
    expect(s.state).toBe('resolved'); // and 'resolved' drops it from Upcoming
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
    expect(s.transmitted.map((r) => r.taskId)).toEqual(['t1']);
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
    expect(s.transmitted).toHaveLength(0);
    expect(s.state).toBeUndefined(); // no design-phase signal at all
  });

  it.each([['Under Review'], ['Corrections'], ['Approved'], ['Submitted']])(
    'post-submittal status %s puts structural work in corrections',
    (status) => {
      expect(split(status).corrections).toHaveLength(1);
      expect(split(status).transmitted).toHaveLength(0);
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
    expect(s.state).toBe('open');
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

// fix-269: DD end is a TARGET SEND date — "when we are targeting to provide
// documents to the external consultant". So a passed date with nothing sent does
// not mean finished, it means LATE. The TRANSMIT TASK is the liveness signal;
// the date only decides presentation.
describe('fix-269 transmit task is the liveness signal', () => {
  const withSss = project({
    id: 'p1',
    address: '4060 E Via Estrella',
    juris: 'Phoenix',
    external_team: { Structural: 'SSS' },
  } as Partial<Project> & { id: string });

  const FUTURE = '2026-09-18';
  const PAST = '2026-03-27'; // four months before TODAY (2026-08-03)

  /** fix-271: p1's block defaults to 'Scheduled', so it is in the design phase
   *  and its structural tasks are the handoff. */
  const DESIGN_P1: ReadonlySet<string> = new Set(['p1']);

  function txTask(over: Partial<WaitingOnTaskRow> = {}) {
    return task({
      task_id: 't1',
      project_id: 'p1',
      task_text: 'Structural - Transmitted',
      start_date: null,
      completion_status: 'Open',
      ...over,
    });
  }

  /** Build UPCOMING for one block + a given set of transmit tasks. */
  function upcoming(targetSend: string | null, tasks: WaitingOnTaskRow[]) {
    return build({
      draw: [block({ project_id: 'p1', dd_end: targetSend, end_week: null })],
      projects: [withSss],
      transmitState: transmitStateByProject(tasks, [withSss], VENDOR_KEY_STRUCTURAL, DESIGN_P1),
    });
  }

  // ---- the decision table, one case per row ----

  it('none + FUTURE target → UPCOMING', () => {
    const rows = upcoming(FUTURE, []);
    expect(rows.map((r) => r.projectId)).toEqual(['p1']);
    expect(rows[0].overdue).toBe(false);
  });

  it('none + PAST target → DROP (no liveness signal at all)', () => {
    expect(upcoming(PAST, [])).toHaveLength(0);
  });

  it('open, not started + FUTURE target → UPCOMING, not flagged', () => {
    const rows = upcoming(FUTURE, [txTask()]);
    expect(rows.map((r) => r.projectId)).toEqual(['p1']);
    expect(rows[0].overdue).toBe(false);
  });

  it('open, not started + PAST target → UPCOMING, flagged OVERDUE', () => {
    // THE Via Estrella shape: target send four months ago, nothing sent, project
    // demonstrably live. Currently invisible; this is the whole point of fix-269.
    const rows = upcoming(PAST, [txTask()]);
    expect(rows.map((r) => r.projectId)).toEqual(['p1']);
    expect(rows[0].overdue).toBe(true);
    expect(rows[0].targetSend).toBe(PAST);
  });

  it.each([[FUTURE], [PAST]])(
    'started, unresolved + %s target → not in UPCOMING (it is in TRANSMITTED)',
    (target) => {
      expect(upcoming(target, [txTask({ start_date: '2026-07-01' })])).toHaveLength(0);
    },
  );

  it.each([[FUTURE], [PAST]])(
    'resolved + %s target → DROP',
    (target) => {
      expect(
        upcoming(target, [
          txTask({ start_date: '2026-07-01', completion_status: 'Resolved' }),
        ]),
      ).toHaveLength(0);
    },
  );

  // ---- interactions ----

  it('all-permits-done OVERRIDES an open transmit task', () => {
    // A task nobody closed is not evidence the work is live.
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: PAST, end_week: null })],
      projects: [withSss],
      transmitState: transmitStateByProject([txTask()], [withSss], VENDOR_KEY_STRUCTURAL, DESIGN_P1),
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
      transmitState: new Map<string, TransmitState>([['late', 'open']]),
    });
    expect(rows.map((r) => r.projectId)).toEqual(['late', 'ontime']);
    expect(rows[0].overdue).toBe(true);
  });

  it('REGRESSION LOCK: a project with NO transmit task behaves exactly as before', () => {
    // Most of the pipeline today. Both sides of the date, unchanged from fix-268.
    expect(upcoming(FUTURE, []).map((r) => r.projectId)).toEqual(['p1']);
    expect(upcoming(PAST, [])).toHaveLength(0);
    // ...and a block with no target send at all is still kept.
    expect(
      build({
        draw: [block({ project_id: 'p1', dd_end: null, end_week: null })],
        projects: [withSss],
      }).map((r) => r.projectId),
    ).toEqual(['p1']);
  });

  it('the end_week fallback still supplies the target send', () => {
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: null, end_week: PAST })],
      projects: [withSss],
      transmitState: transmitStateByProject([txTask()], [withSss], VENDOR_KEY_STRUCTURAL, DESIGN_P1),
    });
    expect(rows[0].overdue).toBe(true);
    expect(rows[0].targetSend).toBe(PAST);
  });

  it('a task on a project the vendor does not own gives no liveness signal', () => {
    const other = project({
      id: 'p1',
      address: '4060 E Via Estrella',
      external_team: { Structural: 'Other Engineers' },
    } as Partial<Project> & { id: string });
    const state = transmitStateByProject([txTask()], [other], VENDOR_KEY_STRUCTURAL, DESIGN_P1);
    expect(state.size).toBe(0);
  });

  describe('transmitStateByProject precedence — live work outranks finished', () => {
    it('started beats open', () => {
      const state = transmitStateByProject(
        [txTask({ task_id: 'a' }), txTask({ task_id: 'b', start_date: '2026-07-01' })],
        [withSss],
        VENDOR_KEY_STRUCTURAL,
        DESIGN_P1,
      );
      expect(state.get('p1')).toBe('started');
    });

    it('open beats resolved — a fresh package is due even if an old one came back', () => {
      const state = transmitStateByProject(
        [
          txTask({ task_id: 'a', start_date: '2026-01-01', completion_status: 'Resolved' }),
          txTask({ task_id: 'b' }),
        ],
        [withSss],
        VENDOR_KEY_STRUCTURAL,
        DESIGN_P1,
      );
      expect(state.get('p1')).toBe('open');
    });

    it('all resolved reads as resolved', () => {
      const state = transmitStateByProject(
        [txTask({ task_id: 'a', start_date: '2026-01-01', completion_status: 'Resolved' })],
        [withSss],
        VENDOR_KEY_STRUCTURAL,
        DESIGN_P1,
      );
      expect(state.get('p1')).toBe('resolved');
    });

    it('a fix-262 Cancelled task is inert — it says nothing about liveness', () => {
      const state = transmitStateByProject(
        [txTask({ task_id: 'a', completion_status: 'Cancelled' })],
        [withSss],
        VENDOR_KEY_STRUCTURAL,
        DESIGN_P1,
      );
      expect(state.size).toBe(0);
    });

    it('no transmit task → no entry (defaults to none)', () => {
      expect(
        transmitStateByProject([], [withSss], VENDOR_KEY_STRUCTURAL, DESIGN_P1).size,
      ).toBe(0);
    });
  });
});

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

  it('sub-permits do not count â€” an open sub cannot keep a finished project in', () => {
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
describe('fix-268 end_week fallback', () => {
  const p = project({ id: 'p1' });

  function visible(dd_end: string | null, end_week: string | null) {
    return drawBlockIsVendorVisible(
      block({ project_id: 'p1', dd_end, end_week }),
      p,
      new Set(),
      TODAY,
    );
  }

  it('dd_end NULL + PAST end_week â†’ excluded', () => {
    expect(visible(null, '2026-06-08')).toBe(false);
  });

  it('dd_end NULL + FUTURE end_week â†’ KEPT (do not over-filter)', () => {
    expect(visible(null, '2026-09-14')).toBe(true);
  });

  it('dd_end NULL + no end_week either â†’ KEPT', () => {
    expect(visible(null, null)).toBe(true);
  });

  it('dd_end PRESENT â†’ the fallback does NOT fire', () => {
    // A future dd_end wins even though end_week is long past: dd_end is primary
    // and where it exists this rule must change nothing.
    expect(visible('2026-09-18', '2025-01-01')).toBe(true);
    // ...and a past dd_end still excludes even with a future end_week.
    expect(visible('2026-08-02', '2027-01-01')).toBe(false);
  });
});

describe('fix-265 inclusion rule', () => {
  const p = project({ id: 'p1' });

  it('includes a plain scheduled block with an address', () => {
    expect(drawBlockIsVendorVisible(block({ project_id: 'p1' }), p, new Set(), TODAY)).toBe(true);
  });

  it('excludes design-phase Corrections blocks â€” already visible on the schedule', () => {
    expect(
      drawBlockIsVendorVisible(
        block({ project_id: 'p1', status: 'Corrections' }),
        p,
        new Set(),
        TODAY,
      ),
    ).toBe(false);
  });

  it('excludes a block opted out via exclude_from_vendor_reports', () => {
    expect(
      drawBlockIsVendorVisible(
        { ...block({ project_id: 'p1' }), exclude_from_vendor_reports: true },
        p,
        new Set(),
        TODAY,
      ),
    ).toBe(false);
  });

  it('excludes CANCELLED projects (fix-264 rule)', () => {
    expect(
      drawBlockIsVendorVisible(block({ project_id: 'p1' }), p, new Set(['p1']), TODAY),
    ).toBe(false);
  });

  it('excludes a block whose DD end is already past', () => {
    expect(
      drawBlockIsVendorVisible(
        block({ project_id: 'p1', dd_end: '2026-08-02' }),
        p,
        new Set(),
        TODAY,
      ),
    ).toBe(false);
  });

  it('KEEPS a block with no DD end â€” a blank is not a reason to hide work', () => {
    // dd_end is NULL on 84 of 124 prod rows. Dropping those would hide most of
    // the pipeline from the vendor; the blank cell prompts the data entry.
    expect(
      drawBlockIsVendorVisible(
        block({ project_id: 'p1', dd_end: null }),
        p,
        new Set(),
        TODAY,
      ),
    ).toBe(true);
  });

  it('excludes a block whose project is missing or address-less', () => {
    // Non-project blocks (Vacation / PTO / training / the OOO floater) live in a
    // SEPARATE table, da_time_blocks, and never reach draw_schedule at all â€” all
    // 124 prod draw rows resolve to a project. This is the defensive backstop.
    expect(drawBlockIsVendorVisible(block({ project_id: 'ghost' }), undefined, new Set(), TODAY)).toBe(false);
    expect(
      drawBlockIsVendorVisible(
        block({ project_id: 'p1' }),
        project({ id: 'p1', address: '   ' }),
        new Set(),
        TODAY,
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
    ['DD end', { sent_dd_end: '2026-08-28' }],
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
    // fix-269: target send is dd_end ?? end_week, so BOTH must be blank for the
    // fact itself to be blank.
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: null, end_week: null })],
      projects: [p1],
      ledger: [ledger({ project_id: 'p1', sent_dd_end: '' })],
    });
    expect(rows[0].bucket).toBe('unchanged');
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
    expect(rows[0].targetSend).toBe('2026-10-05');
    expect(rows[0].bucket).toBe('changed');
    expect(rows[0].previous?.targetSend).toBe('2026-09-14');
  });

  it('fix-269: the send payload records the target send, not raw dd_end', () => {
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: null, end_week: '2026-10-05' })],
      projects: [p1],
    });
    expect(vendorSentPayload(rows)[0].dd_end).toBe('2026-10-05');
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

describe('fix-265 sections â€” the RUNNING LIST rule', () => {
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

    // Week 1: it moves â€” but nobody sends the email that week.
    const wk1 = [block({ project_id: 'p1', start_week: '2026-08-17' })];
    const skipped = splitVendorSections(build({ draw: wk1, projects: [p1], ledger: state }));
    expect(skipped.changedRows).toHaveLength(1);

    // Week 2: it moves AGAIN. Because the ledger still holds the last COMMUNICATED
    // value (not last week's computed value), the delta shown is the full move
    // from what the vendor actually knows â€” the week-1 change is not lost.
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

describe('fix-265 reuse columns', () => {
  it('resolves the reuse source address and carries reuse_notes', () => {
    const source = project({ id: 'src', address: '13515 27th Ave NE' });
    const p = project({
      id: 'p1',
      address: '100 A St',
      reused_from_project_id: 'src',
      reuse_notes: 'W/O GAR',
    });
    const rows = build({ draw: [block({ project_id: 'p1' })], projects: [p, source] });
    expect(rows[0].reuseFromAddress).toBe('13515 27th Ave NE');
    expect(rows[0].reuseNotes).toBe('W/O GAR');
  });

  it('leaves reuse blank rather than guessing when unset (2 of 124 prod rows have it)', () => {
    const rows = build({
      draw: [block({ project_id: 'p1' })],
      projects: [project({ id: 'p1', address: '100 A St' })],
    });
    expect(rows[0].reuseFromAddress).toBeNull();
    expect(rows[0].reuseNotes).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 4 â€” corrections with the vendor
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

  function rowsFor(tasks: WaitingOnTaskRow[], cancelled?: Set<string>) {
    return buildVendorCorrectionRows(
      tasks,
      [withSss, withOther, withNoFirm],
      VENDOR_KEY_STRUCTURAL,
      NO_DESIGN,
      cancelled,
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


