import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// fix-265: the Vendor Schedule Forecast page.
//
// The single most important assertion in this file is that COMPOSING AN EMAIL
// DOES NOT WRITE THE LEDGER. Bobby previews drafts he does not send; a compose
// that silently marked things sent would make those projects vanish from next
// week's email — which is exactly the failure the feature exists to fix.

const projectsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const permitsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const drawRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const holdsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const ledgerRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const waitingRef = vi.hoisted(() => ({ current: [] as unknown[] }));
// ★★★ fix-499: the CONSULTANT RECORDS are what put a project on this report.
//     `useVendorReportExtras` is gone (its Reuse column went with it), and this
//     ref replaced it.
const consultantsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const directoryRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const configRef = vi.hoisted(() => ({ current: new Map<string, unknown>() }));
const markSentMutate = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: projectsRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: permitsRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: drawRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useWaitingOnTasks', () => ({
  useWaitingOnTasks: () => ({ data: waitingRef.current, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: configRef.current, isLoading: false, error: null }),
}));
vi.mock('../hooks/useConsultantCurrent', () => ({
  useConsultantCurrent: () => ({
    data: consultantsRef.current,
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({
    data: directoryRef.current,
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../hooks/useVendorReportState', () => ({
  useVendorReportState: () => ({
    data: ledgerRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMarkVendorReportSent: () => ({ mutate: markSentMutate, isPending: false }),
}));
// Partial mock — the REAL cancelledProjectIds / activeHoldByProjectId run.
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({
      data: holdsRef.current,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

import VendorScheduleForecastReport from '../pages/VendorScheduleForecastReport';

function project(over: Record<string, unknown> & { id: string }) {
  return { address: `${over.id} Main St`, juris: 'Seattle', archived: false, ...over };
}

function block(over: Record<string, unknown> & { project_id: string }) {
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
  };
}

function openHold(projectId: string, kind: 'hold' | 'cancelled', reason = 'because') {
  return {
    id: `h-${projectId}`,
    project_id: projectId,
    kind,
    reason,
    note: null,
    hold_start: '2026-06-01',
    hold_end: null,
  };
}

const RECIPIENTS = {
  structural: {
    label: 'SSS Engineering',
    to: [{ name: 'Tawny Glenn', email: 't.glenn@ssseng.com' }],
    cc: [{ name: 'Brittani Ard', email: 'brittani@example.com' }],
  },
};

/** ★ fix-499: a Scheduled Structural round on every fixture project unless a
 *  test supplies its own. Same reasoning as the pure-core suite: `Scheduled`
 *  ("nothing sent yet") is the state these tests always implicitly assumed. */
function consultant(over: Record<string, unknown> & { project_id: string }) {
  return {
    consultant_id: `c-${over.project_id}`,
    discipline: 'Structural',
    firm_name: 'SSS',
    firm_active: true,
    status: 'Scheduled',
    est_send: null,
    sent: null,
    est_recd: null,
    recd: null,
    round_index: 1,
    round_count: 1,
    ...over,
  };
}

function renderPage(path = '/reports/vendor-forecast') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VendorScheduleForecastReport />
    </MemoryRouter>,
  );
}

let createdBlobs: Blob[] = [];
let clickedAnchors: HTMLAnchorElement[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));
  markSentMutate.mockReset();
  projectsRef.current = [
    project({ id: 'p-new', address: '554 N 75th St' }),
    project({ id: 'p-moved', address: '4017 Corliss Ave N' }),
    project({ id: 'p-same', address: '2450 3rd Ave W' }),
  ];
  drawRef.current = [
    block({ project_id: 'p-new' }),
    block({ project_id: 'p-moved', start_week: '2026-08-24' }),
    block({ project_id: 'p-same' }),
  ];
  ledgerRef.current = [
    {
      project_id: 'p-moved',
      sent_start_week: '2026-08-10',
      // ★ fix-309 #48: the ledger stores the TARGET SEND, and that is now a
      // week before dd_end (2026-09-18), not dd_end itself.
      sent_dd_end: '2026-09-11',
      sent_status: 'Scheduled',
      sent_at: '2026-07-27T17:00:00Z',
    },
    {
      project_id: 'p-same',
      sent_start_week: '2026-08-10',
      // ★ fix-309 #48: the ledger stores the TARGET SEND, and that is now a
      // week before dd_end (2026-09-18), not dd_end itself.
      sent_dd_end: '2026-09-11',
      sent_status: 'Scheduled',
      sent_at: '2026-07-27T17:00:00Z',
    },
  ];
  holdsRef.current = [];
  permitsRef.current = [];
  waitingRef.current = [];
  consultantsRef.current = projectsRef.current.map((p) =>
    consultant({ project_id: (p as { id: string }).id }),
  );
  directoryRef.current = [];
  configRef.current = new Map<string, unknown>([['vendorReportRecipients', RECIPIENTS]]);

  createdBlobs = [];
  clickedAnchors = [];
  // jsdom has no object-URL support; capture instead.
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b) => {
    createdBlobs.push(b);
    return 'blob:mock';
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  const realClick = HTMLAnchorElement.prototype.click;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedAnchors.push(this);
  });
  void realClick;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('<VendorScheduleForecastReport /> sections (fix-265)', () => {
  it('buckets new / changed and shows all three on the running pipeline', () => {
    renderPage();
    expect(screen.getByTestId('vsf-new-count').textContent).toBe('(1)');
    expect(screen.getByTestId('vsf-changed-count').textContent).toBe('(1)');
    expect(screen.getByTestId('vsf-pipeline-count').textContent).toBe('(3)');
    expect(screen.getByTestId('vsf-new-row-p-new')).toBeInTheDocument();
    expect(screen.getByTestId('vsf-changed-row-p-moved')).toBeInTheDocument();
  });

  it('REGRESSION LOCK: an already-sent, unchanged project stays on the pipeline', () => {
    // "we want to keep the list a running list, that way nothing is missed."
    renderPage();
    expect(screen.getByTestId('vsf-pipeline-row-p-same')).toBeInTheDocument();
    // ...and is correctly absent from new/changed.
    expect(screen.queryByTestId('vsf-new-row-p-same')).toBeNull();
    expect(screen.queryByTestId('vsf-changed-row-p-same')).toBeNull();
  });

  it('the changes row shows OLD and NEW, not just the new value', () => {
    renderPage();
    const changed = screen.getByTestId('vsf-changed-row-p-moved');
    expect(changed.textContent).toContain('2026-08-10'); // old
    expect(changed.textContent).toContain('2026-08-24'); // new
  });

  it('hides cancelled projects and labels held ones', () => {
    holdsRef.current = [
      openHold('p-new', 'cancelled'),
      openHold('p-same', 'hold', 'Waiting on survey'),
    ];
    renderPage();
    expect(screen.queryByTestId('vsf-pipeline-row-p-new')).toBeNull();
    expect(screen.getByTestId('vsf-pipeline-row-p-same')).toBeInTheDocument();
    expect(screen.getAllByTestId('vsf-hold-p-same')[0].textContent).toContain('Waiting on survey');
  });

  // fix-266: post-submittal work is off the pipeline — structural's involvement
  // ends when the drawings go to the city.
  it('excludes Approved and Under Review from the rendered pipeline', () => {
    drawRef.current = [
      block({ project_id: 'p-new', status: 'Scheduled' }),
      block({ project_id: 'p-moved', status: 'Approved' }),
      block({ project_id: 'p-same', status: 'Under Review' }),
    ];
    renderPage();
    expect(screen.getByTestId('vsf-pipeline-count').textContent).toBe('(1)');
    expect(screen.getByTestId('vsf-pipeline-row-p-new')).toBeInTheDocument();
    expect(screen.queryByTestId('vsf-pipeline-row-p-moved')).toBeNull();
    expect(screen.queryByTestId('vsf-pipeline-row-p-same')).toBeNull();
  });

  it('excludes Corrections-status blocks and excluded blocks', () => {
    drawRef.current = [
      block({ project_id: 'p-new', status: 'Corrections' }),
      block({ project_id: 'p-moved', exclude_from_vendor_reports: true }),
    ];
    projectsRef.current = projectsRef.current.slice(0, 2);
    consultantsRef.current = projectsRef.current.map((p) =>
      consultant({ project_id: (p as { id: string }).id }),
    );
    renderPage();
    // fix-268: an empty section is omitted entirely — heading, count and all.
    expect(screen.queryByTestId('vsf-pipeline')).toBeNull();
    expect(screen.getByTestId('vsf-all-empty')).toBeInTheDocument();
  });

  it('★★★ SUPERSEDED BY fix-499: a past-DD block is FLAGGED, not excluded', () => {
    // ★★★ It used to be in the list above, asserted as excluded. fix-269's
    //     reasoning was "no transmit task, so no evidence the work is live".
    //     A Scheduled consultant round IS that evidence, so the row stays and
    //     says it is late instead of disappearing on the day it matters most.
    drawRef.current = [block({ project_id: 'p-same', dd_end: '2026-08-01', end_week: null })];
    projectsRef.current = [project({ id: 'p-same', address: '2450 3rd Ave W' })];
    consultantsRef.current = [consultant({ project_id: 'p-same' })];
    ledgerRef.current = [];
    renderPage();
    expect(screen.getByTestId('vsf-pipeline-row-p-same')).toBeInTheDocument();
    expect(screen.getByTestId('vsf-overdue-pipeline-p-same')).toBeInTheDocument();
  });

  it('shows the corrections section with blanks for missing dates', () => {
    projectsRef.current = [
      project({ id: 'p1', address: '100 A St', external_team: { Structural: 'SSS' } }),
    ];
    waitingRef.current = [
      {
        task_id: 't1',
        task_text: 'Structural backgrounds',
        waiting_on: 'Structural',
        project_id: 'p1',
        project_address: '100 A St',
        permit_id: 1,
        permit_type: 'Building Permit',
        start_date: null,
        target_date: null,
        due_date: null,
        completion_status: 'Open',
      },
      {
        task_id: 't2',
        task_text: 'Done already',
        waiting_on: 'Structural',
        project_id: 'p1',
        permit_id: 1,
        completion_status: 'Resolved',
      },
    ];
    renderPage();
    expect(screen.getByTestId('vsf-corrections-count').textContent).toBe('(1)');
    const row = screen.getByTestId('vsf-correction-row-t1');
    // fix-271: permit type, not the task text. p1 has no draw block in this
    // fixture, so it counts as permitting.
    expect(row.textContent).toContain('Building Permit');
    expect(row.textContent).not.toContain('Structural backgrounds');
    expect(row.textContent).toContain('—'); // blank dates, row not dropped
    expect(screen.queryByTestId('vsf-correction-row-t2')).toBeNull();
  });

  it('★★ SUPERSEDED BY fix-499 §C: there is no migration-pending banner', () => {
    // It warned that `reuse_notes` was unavailable. The Reuse column went, the
    // hook that fetched it went, and the banner had nothing left to warn about.
    renderPage();
    expect(screen.queryByTestId('vsf-migration-pending')).toBeNull();
  });

  it('warns about a recipient with no address and disables compose with no To', () => {
    configRef.current = new Map<string, unknown>([
      [
        'vendorReportRecipients',
        { structural: { label: 'SSS', to: [], cc: [{ name: 'Shire Mahdi', email: '' }] } },
      ],
    ]);
    renderPage();
    expect(screen.getByTestId('vsf-no-recipients')).toBeInTheDocument();
    expect(screen.getByTestId('vsf-missing-emails').textContent).toContain('Shire Mahdi');
    expect(screen.getByTestId('vsf-compose')).toBeDisabled();
  });
});

// ★★★ fix-499: this describe was fix-268's TRANSMIT-TASK state, end to end
//     through the page. The sections are decided by the consultant round now,
//     so each case supplies a round instead of a task — the assertions about
//     what the SCREEN shows are unchanged, which is the point.
describe('<VendorScheduleForecastReport /> round state (fix-268 → fix-499)', () => {
  const SSS_PROJECT = {
    id: 'p-new',
    address: '554 N 75th St',
    juris: 'Seattle',
    archived: false,
    external_team: { Structural: 'SSS' },
  };

  function transmitTask(over: Record<string, unknown> = {}) {
    return {
      task_id: 'tx1',
      task_text: 'Structural - Transmitted',
      waiting_on: 'Structural',
      project_id: 'p-new',
      project_address: '554 N 75th St',
      project_juris: 'Seattle',
      permit_id: 1,
      permit_type: 'Building Permit',
      start_date: null,
      target_date: null,
      due_date: null,
      completion_status: 'Open',
      ...over,
    };
  }

  beforeEach(() => {
    projectsRef.current = [SSS_PROJECT];
    drawRef.current = [block({ project_id: 'p-new' })];
    ledgerRef.current = [];
    consultantsRef.current = [consultant({ project_id: 'p-new' })];
  });

  it('★★★ a PENDING round moves the project out of PIPELINE into TRANSMITTED', () => {
    consultantsRef.current = [
      consultant({
        project_id: 'p-new',
        status: 'Pending',
        sent: '2026-09-18',
        est_recd: '2026-10-02',
      }),
    ];
    renderPage();
    expect(screen.getByTestId('vsf-transmitted-row-p-new')).toBeInTheDocument();
    expect(screen.queryByTestId('vsf-pipeline-row-p-new')).toBeNull();
    const row = screen.getByTestId('vsf-transmitted-row-p-new');
    expect(row.textContent).toContain('2026-09-18');
    expect(row.textContent).toContain('2026-10-02');
  });

  it('a SCHEDULED round leaves the project in PIPELINE and shows no section 4', () => {
    renderPage();
    expect(screen.getByTestId('vsf-pipeline-row-p-new')).toBeInTheDocument();
    expect(screen.queryByTestId('vsf-transmitted')).toBeNull();
  });

  it('★★★ a RECEIVED round appears in neither section — it falls off', () => {
    // Bobby: "once it's completed, it would fall off this list."
    consultantsRef.current = [
      consultant({ project_id: 'p-new', status: 'Received', sent: '2026-09-18', recd: '2026-10-01' }),
    ];
    renderPage();
    expect(screen.queryByTestId('vsf-transmitted')).toBeNull();
    expect(screen.queryByTestId('vsf-pipeline-row-p-new')).toBeNull();
  });

  it('★★★ a project with NO consultant record is not on the report at all', () => {
    consultantsRef.current = [];
    renderPage();
    expect(screen.getByTestId('vsf-all-empty')).toBeInTheDocument();
  });

  // fix-271: this used to assert the opposite. Under text matching, a task named
  // "Structural CR1" on a PRE-SUBMITTAL project landed in CORRECTIONS — the
  // 7708/7336 misfiling. Phase decides now, so on a Scheduled project it is the
  // design handoff whatever it is called.
  it('a differently-named structural task on a pre-submittal project is DESIGN', () => {
    // ★ fix-271's rule, unchanged: on a pre-submittal project a structural task
    //   is NOT a correction, whatever it is called. What decides which design
    //   section the project lands in is the round, so the fixture sets one.
    waitingRef.current = [
      transmitTask({
        task_id: 'cr1',
        task_text: 'Structural CR1',
        completion_status: 'In Progress',
        start_date: '2026-07-20',
      }),
    ];
    consultantsRef.current = [
      consultant({ project_id: 'p-new', status: 'Pending', sent: '2026-07-20' }),
    ];
    renderPage();
    expect(screen.queryByTestId('vsf-correction-row-cr1')).toBeNull();
    expect(screen.getByTestId('vsf-transmitted-row-p-new')).toBeInTheDocument();
    expect(screen.queryByTestId('vsf-pipeline-row-p-new')).toBeNull();
  });

  it('the SAME task on a post-submittal project is a correction', () => {
    drawRef.current = [block({ project_id: 'p-new', status: 'Under Review' })];
    waitingRef.current = [
      transmitTask({
        task_id: 'cr1',
        task_text: 'Structural CR1',
        completion_status: 'In Progress',
        start_date: '2026-07-20',
        permit_type: 'PPR',
      }),
    ];
    renderPage();
    const row = screen.getByTestId('vsf-correction-row-cr1');
    expect(row).toBeInTheDocument();
    // fix-271 columns: permit type in, task text out.
    expect(row.textContent).toContain('PPR');
    expect(row.textContent).not.toContain('Structural CR1');
    expect(screen.queryByTestId('vsf-transmitted')).toBeNull();
  });

  it('a project whose permits have all issued leaves the pipeline', () => {
    permitsRef.current = [
      { project_id: 'p-new', actual_issue: '2026-05-22', status: 'Completed', parent_permit_id: null },
    ];
    renderPage();
    expect(screen.queryByTestId('vsf-pipeline-row-p-new')).toBeNull();
  });

  it('★★★ SUPERSEDED BY fix-499: a stale block is FLAGGED overdue, not dropped', () => {
    drawRef.current = [
      block({ project_id: 'p-new', dd_end: null, end_week: '2026-06-08' }),
    ];
    renderPage();
    expect(screen.getByTestId('vsf-pipeline-row-p-new')).toBeInTheDocument();
    expect(screen.getByTestId('vsf-overdue-pipeline-p-new')).toBeInTheDocument();
  });

  // fix-269: the Via Estrella shape, end to end through the page.
  it('an open unstarted transmit with a target send FOUR MONTHS past shows, flagged', () => {
    drawRef.current = [
      block({
        project_id: 'p-new',
        status: 'Pending Consultants',
        dd_end: '2026-03-27',
        end_week: '2026-03-23',
      }),
    ];
    waitingRef.current = [transmitTask({ start_date: null })];
    renderPage();
    const row = screen.getByTestId('vsf-pipeline-row-p-new');
    expect(row).toBeInTheDocument();
    const marker = screen.getByTestId('vsf-overdue-pipeline-p-new');
    expect(marker.textContent).toContain('OVERDUE');
    // ★ fix-309 #48: dd_end 2026-03-27, so the target send is a week earlier.
    expect(marker.textContent).toContain('2026-03-20');
    // The date column shows the target send, not dd_end.
    expect(row.textContent).toContain('2026-03-20');
    expect(row.textContent).not.toContain('2026-03-27');
  });

  it('★★★ SUPERSEDED BY fix-499: the same block with NO TASK is now VISIBLE', () => {
    // ★★★ THE INVERSION, ON THE MAJORITY CASE. This was the regression lock on
    //     fix-268's rule — "without a liveness signal a passed target send drops
    //     the row". Measured on prod 2026-09-04: 43 live Structural rounds
    //     against 8 open Structural tasks, so that rule was hiding most of the
    //     work most of the time. The round is the liveness signal now, and 37
    //     of the 43 are Scheduled.
    drawRef.current = [
      block({ project_id: 'p-new', dd_end: '2026-03-27', end_week: '2026-03-23' }),
    ];
    waitingRef.current = [];
    renderPage();
    expect(screen.getByTestId('vsf-pipeline-row-p-new')).toBeInTheDocument();
    expect(screen.getByTestId('vsf-overdue-pipeline-p-new')).toBeInTheDocument();
  });

  it('empty sections are omitted — no stray headers', () => {
    waitingRef.current = [];
    renderPage();
    // Only the pipeline has anything this week.
    expect(screen.getByTestId('vsf-pipeline')).toBeInTheDocument();
    expect(screen.queryByTestId('vsf-changed')).toBeNull();
    expect(screen.queryByTestId('vsf-transmitted')).toBeNull();
    expect(screen.queryByTestId('vsf-corrections')).toBeNull();
    expect(screen.queryByTestId('vsf-all-empty')).toBeNull();
  });
});

describe('<VendorScheduleForecastReport /> compose vs send (fix-265)', () => {
  it('COMPOSE DOES NOT WRITE THE LEDGER', () => {
    // THE most important behavioural rule in this feature. Bobby previews drafts
    // he does not send; if composing marked things sent, those projects would
    // silently vanish from next week's email.
    renderPage();
    fireEvent.click(screen.getByTestId('vsf-compose'));
    expect(markSentMutate).not.toHaveBeenCalled();
  });

  it('compose downloads a .eml draft', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('vsf-compose'));
    expect(createdBlobs).toHaveLength(1);
    expect(createdBlobs[0].type).toBe('message/rfc822');
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].download).toBe(
      'structural-schedule-forecast-2026-08-03.eml',
    );
  });

  it('COPY AS HTML DOES NOT WRITE THE LEDGER EITHER', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPage();
    fireEvent.click(screen.getByTestId('vsf-copy'));
    expect(markSentMutate).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('<table');
  });

  it('MARK AS SENT records exactly the rows on the running list', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('vsf-mark-sent'));
    expect(markSentMutate).toHaveBeenCalledTimes(1);
    const arg = markSentMutate.mock.calls[0][0];
    expect(arg.vendorKey).toBe('structural');
    // All three pipeline rows — new, changed AND already-sent — because after a
    // send the vendor knows the current state of everything on the list.
    expect(arg.rows.map((r: { project_id: string }) => r.project_id).sort()).toEqual([
      'p-moved',
      'p-new',
      'p-same',
    ]);
    // Carrying the CURRENT facts is what makes the next run's diff correct.
    const moved = arg.rows.find((r: { project_id: string }) => r.project_id === 'p-moved');
    expect(moved.start_week).toBe('2026-08-24');
  });

  it('excluded rows are never recorded as sent', () => {
    drawRef.current = [
      block({ project_id: 'p-new' }),
      block({ project_id: 'p-moved', status: 'Corrections' }),
    ];
    renderPage();
    fireEvent.click(screen.getByTestId('vsf-mark-sent'));
    const arg = markSentMutate.mock.calls[0][0];
    expect(arg.rows.map((r: { project_id: string }) => r.project_id)).toEqual(['p-new']);
  });

  it('reports never-sent vs last-sent', () => {
    ledgerRef.current = [];
    const { unmount } = renderPage();
    expect(screen.getByTestId('vsf-never-sent')).toBeInTheDocument();
    unmount();

    ledgerRef.current = [
      {
        project_id: 'p-same',
        sent_start_week: '2026-08-10',
        // ★ fix-309 #48: the ledger stores the TARGET SEND, and that is now a
      // week before dd_end (2026-09-18), not dd_end itself.
      sent_dd_end: '2026-09-11',
        sent_status: 'Scheduled',
        sent_at: '2026-07-27T17:00:00Z',
      },
    ];
    renderPage();
    expect(screen.getByTestId('vsf-last-sent')).toBeInTheDocument();
  });
});
