import { describe, it, expect } from 'vitest';
import {
  VENDOR_KEY_STRUCTURAL,
  VENDOR_PIPELINE_STATUSES,
  buildVendorTransmitRows,
  transmitStartedProjectIds,
  allPermitsDoneProjectIds,
  isTransmitTask,
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
  transmitStartedIds?: Set<string>;
}) {
  return buildVendorScheduleRows({
    draw: opts.draw,
    projects: opts.projects,
    ledger: opts.ledger ?? [],
    cancelledIds: opts.cancelledIds,
    holdsByProject: opts.holdsByProject,
    allPermitsDoneIds: opts.allPermitsDoneIds,
    transmitStartedIds: opts.transmitStartedIds,
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

  it('keeps the dd_end gate as well — it still fires within an allowed status', () => {
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
    );
    expect(corrections.map((r) => r.taskId)).toEqual(['t1']);
  });
});

// fix-268: the design-phase handoff. A project is "coming to you" (section 3) or
// "with you" (section 4), never both, and it leaves both when the transmit task
// is Resolved. Told apart from corrections by TASK TEXT, because permit_tasks has
// no template_id — verified on prod.
describe('fix-268 transmit task ⇄ pipeline', () => {
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

  function sections(tasks: WaitingOnTaskRow[]) {
    const transmitted = buildVendorTransmitRows(
      tasks,
      [withSss],
      VENDOR_KEY_STRUCTURAL,
    );
    const rows = build({
      draw: [block({ project_id: 'p1' })],
      projects: [withSss],
      transmitStartedIds: transmitStartedProjectIds(transmitted),
    });
    return {
      transmitted,
      pipeline: splitVendorSections(rows).pipelineRows,
      corrections: buildVendorCorrectionRows(tasks, [withSss], VENDOR_KEY_STRUCTURAL),
    };
  }

  it('NOT STARTED: project is in PIPELINE, not in TRANSMITTED', () => {
    // A transmit task that exists but has not started is not "with them" —
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

  it('RESOLVED: in neither — received, and it leaves design-phase tracking', () => {
    const s = sections([
      transmitTask({ start_date: '2026-09-18', completion_status: 'Resolved' }),
    ]);
    expect(s.transmitted).toHaveLength(0);
    expect(s.pipeline.map((r) => r.projectId)).toEqual(['p1']);
    // ...and it is not a correction either.
    expect(s.corrections).toHaveLength(0);
  });

  it('a started transmit task never ALSO shows as a correction', () => {
    // Design phase and permitting phase never blur.
    const s = sections([transmitTask({ start_date: '2026-09-18' })]);
    expect(s.corrections).toHaveLength(0);
  });

  it('a NON-transmit structural task is a CORRECTION, never TRANSMITTED', () => {
    const s = sections([
      task({
        task_id: 'c1',
        project_id: 'p1',
        task_text: 'Structural CR1',
        completion_status: 'In Progress',
        start_date: '2026-07-20',
      }),
    ]);
    expect(s.transmitted).toHaveLength(0);
    expect(s.corrections.map((r) => r.taskId)).toEqual(['c1']);
    // ...and it does NOT pull the project out of the pipeline.
    expect(s.pipeline.map((r) => r.projectId)).toEqual(['p1']);
  });

  // The four live text variants on prod. None may crash; each must land
  // somewhere defensible. Everything unmatched falls to CORRECTIONS, which is
  // the safe default for a string match against text that has already drifted.
  it.each([
    ['Structural - Transmitted', 'transmitted'], // the live template
    ['Sent to Structural', 'transmitted'], // legacy variant
    ['Structural', 'corrections'], // too generic to claim
    ['Structural CR1', 'corrections'], // CR = correction round
  ])('legacy text %s lands in %s', (text, where) => {
    const s = sections([
      task({
        task_id: 'x1',
        project_id: 'p1',
        task_text: text,
        completion_status: 'In Progress',
        start_date: '2026-07-20',
      }),
    ]);
    if (where === 'transmitted') {
      expect(s.transmitted.map((r) => r.taskId)).toEqual(['x1']);
      expect(s.corrections).toHaveLength(0);
    } else {
      expect(s.corrections.map((r) => r.taskId)).toEqual(['x1']);
      expect(s.transmitted).toHaveLength(0);
    }
  });

  it('isTransmitTask is case- and whitespace-insensitive, and never matches junk', () => {
    expect(isTransmitTask('  STRUCTURAL - TRANSMITTED  ', VENDOR_KEY_STRUCTURAL)).toBe(true);
    expect(isTransmitTask(null, VENDOR_KEY_STRUCTURAL)).toBe(false);
    expect(isTransmitTask('', VENDOR_KEY_STRUCTURAL)).toBe(false);
    expect(isTransmitTask('Landscape - Transmitted', VENDOR_KEY_STRUCTURAL)).toBe(false);
    expect(isTransmitTask('Structural - Transmitted', 'civil')).toBe(false);
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
      ),
    ).toHaveLength(0);
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

  it('all non-sub permits done → project id returned', () => {
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

  it('dd_end NULL + PAST end_week → excluded', () => {
    expect(visible(null, '2026-06-08')).toBe(false);
  });

  it('dd_end NULL + FUTURE end_week → KEPT (do not over-filter)', () => {
    expect(visible(null, '2026-09-14')).toBe(true);
  });

  it('dd_end NULL + no end_week either → KEPT', () => {
    expect(visible(null, null)).toBe(true);
  });

  it('dd_end PRESENT → the fallback does NOT fire', () => {
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

  it('excludes design-phase Corrections blocks — already visible on the schedule', () => {
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

  it('KEEPS a block with no DD end — a blank is not a reason to hide work', () => {
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
    // SEPARATE table, da_time_blocks, and never reach draw_schedule at all — all
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

  it('no ledger row → NEW', () => {
    const rows = build({ draw: [block({ project_id: 'p1' })], projects: [p1] });
    expect(rows[0].bucket).toBe('new');
    expect(rows[0].previous).toBeNull();
  });

  it('identical ledger row → UNCHANGED, with no previous', () => {
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
  ])('a moved %s → CHANGED, carrying the old value', (_label, patch) => {
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
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: null })],
      projects: [p1],
      ledger: [ledger({ project_id: 'p1', sent_dd_end: '' })],
    });
    expect(rows[0].bucket).toBe('unchanged');
  });

  it('blank → a value IS a change (the vendor learns a date they did not have)', () => {
    const rows = build({
      draw: [block({ project_id: 'p1', dd_end: '2026-09-18' })],
      projects: [p1],
      ledger: [ledger({ project_id: 'p1', sent_dd_end: null })],
    });
    expect(rows[0].bucket).toBe('changed');
    expect(rows[0].previous?.ddEnd).toBeNull();
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
      block({ project_id: 'p1' }), // never sent      → new
      block({ project_id: 'p2', start_week: '2026-08-17' }), // moved → changed
      block({ project_id: 'p3' }), // sent, unchanged → pipeline only
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

  function rowsFor(tasks: WaitingOnTaskRow[], cancelled?: Set<string>) {
    return buildVendorCorrectionRows(
      tasks,
      [withSss, withOther, withNoFirm],
      VENDOR_KEY_STRUCTURAL,
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
