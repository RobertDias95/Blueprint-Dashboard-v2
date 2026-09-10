import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project, Stage } from '../lib/database.types';
import {
  PERMIT_SORT_FIRST_DIR,
  PERMIT_TABLE_PHASE_ORDER,
  defaultComparePermits,
  sortPermitRows,
  type PermitSortRow,
} from '../lib/permitTableOrder';

// ===========================================================================
// ★★★ fix-517 (P-219, P-223) — THE PERMITS RAIL BECOMES THE TABLE
// ===========================================================================
//
// Bobby: *"on the left-hand side of Project Overview, we're going to get rid of
// Permits. And what we're going to do is kind of merge that section of Permits
// with Schedule Health, because all of that information is kind of
// redundant."*
//
// This file is where the rail's behaviours are asserted now that the rail is
// gone. Four suites moved here — `ProjectDetail.test.tsx`'s fix-23e / fix-65 /
// fix-508 §E / fix-194 blocks, and `RedesignPermitsBandFix421`'s §A / §B —
// because those files STUB `ScheduleHealthTable` and always have. Each of them
// carries a note saying so; none of them was deleted.
// ===========================================================================

const T = 'test-tenant-uuid';
const NOW = '2026-05-15T12:00:00Z';

const refsPermits = vi.hoisted(() => ({ current: [] as unknown[] }));
const refsProjects = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: refsPermits.current, isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: refsProjects.current, isLoading: false }),
}));
vi.mock('../hooks/usePermitTypeDefaults', () => ({
  usePermitTypeDefaults: () => ({ byType: new Map<string, number>(), isLoading: false }),
}));
// ★ The reviewer chip owns its own click (a popover). §D exempts the whole
//   cell from the row click, so the stub carries a click target of its own —
//   otherwise "clicking Reviewers does not navigate" would pass on a cell with
//   nothing clickable in it, which is the assertion passing for the wrong
//   reason.
vi.mock('../components/ProjectDetail/ReviewerRollupChip', () => ({
  default: ({ permitId }: { permitId: number }) => (
    <button type="button" data-testid={`reviewer-chip-${permitId}`}>
      chip
    </button>
  ),
}));

import ScheduleHealthTable from '../components/ProjectDetail/ScheduleHealthTable';
import tableSrc from '../components/ProjectDetail/ScheduleHealthTable.tsx?raw';
import pageSrc from '../pages/ProjectDetail.tsx?raw';
import formSrc from '../components/ProjectDetail/ProjectDetailsForm.tsx?raw';

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p-517',
    address: '5053 25th Ave SW',
    juris: 'Seattle',
    archived: false,
    notes: null,
    acq_lead: null,
    external_team: {},
    builder_id: null,
    permit_order: [],
    entitlement_lead: null,
    design_manager: null,
    go_date: null,
    units: null,
    zone: null,
    lot_width: null,
    lot_depth: null,
    lot_size_sf: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    alley: null,
    product_types: [],
    project_tags: null,
    builder_name: null,
    builder_company: null,
    builder_email: null,
    builder_phone: null,
    closing_date: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as unknown as Project;
}

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p-517',
    type: 'Building Permit',
    num: 'BP-001',
    status: null,
    portal_url: null,
    struct_address: null,
    parent_permit_id: null,
    ent_lead: null,
    dm: null,
    da: null,
    dual_da: null,
    architect: null,
    kickoff_date: null,
    dd_start: null,
    dd_end: null,
    expected_issue: '2026-08-01',
    target_submit: null,
    intake_date: null,
    approval_date: null,
    actual_issue: null,
    corr_rounds: null,
    extras: null,
    last_scraper_update_at: null,
    nickname: null,
    cycle_model: null,
    view_cycle: null,
    notes: null,
    created_at: NOW,
    updated_at: NOW,
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

const selected: number[] = [];
const edited: number[] = [];

function renderTable(
  permits: PermitWithCycles[],
  opts: { projects?: Project[]; redesignLabels?: Map<number, string> } = {},
) {
  refsPermits.current = permits as unknown[];
  refsProjects.current = (opts.projects ?? [project()]) as unknown[];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <ScheduleHealthTable
      permits={permits}
      redesignLabelByPermitId={opts.redesignLabels}
      onSelect={(id) => selected.push(id)}
      onEditPermit={(id) => edited.push(id)}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  selected.length = 0;
  edited.length = 0;
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

/** A row model carrying only what the sort reads. */
function sortRow(over: Partial<PermitSortRow> & { id: number }): PermitSortRow {
  return {
    typeLabel: 'Building Permit',
    num: null,
    stage: 'pm',
    statusLabel: '',
    sourceLabel: 'Default',
    approvalIso: null,
    targetIso: null,
    healthDiff: null,
    orderRank: Number.MAX_SAFE_INTEGER,
    issuedIso: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// §A — the rail is deleted, SCHEDULE HEALTH is retitled
// ---------------------------------------------------------------------------

describe('fix-517 §A — the heading is PERMITS (n), in both directions', () => {
  it('★★★ the heading reads `PERMITS (n)` and `SCHEDULE HEALTH` appears nowhere', () => {
    // ★★★ BOTH DIRECTIONS IN ONE TEST, which is §F's lesson applied to §A.
    //     fix-514 asserted only that a retired name was ABSENT and shipped a
    //     button reading a third name, so this asserts the new title is PRESENT
    //     and the old one is GONE. Either half alone passes on a wrong screen.
    const { container } = renderTable([permit({ id: 1 }), permit({ id: 2, type: 'Demolition' })]);
    expect(screen.getByTestId('permits-table-heading').textContent).toBe('Permits (2)');
    const text = (container.textContent ?? '').toUpperCase();
    expect(text).not.toContain('SCHEDULE HEALTH SECTION');
    // The HEADING must not say it. The COLUMN still does — it is a column.
    expect(
      screen.getByTestId('permits-table-heading').textContent?.toUpperCase(),
    ).not.toContain('SCHEDULE HEALTH');
    expect(screen.getByTestId('permits-sort-health').textContent).toContain(
      'Schedule Health',
    );
  });

  it('★★★ n counts THE ROWS BELOW IT, redesign permits included', () => {
    // ★★★ THE RAIL'S COUNT WAS NOT COPYABLE. `Permits (n)` in the rail counted
    //     this project's permits only — a redesign's were a separate band with
    //     its own count. This table has rendered the whole LINEAGE since
    //     fix-151, so a count carried across verbatim would have disagreed with
    //     the list under it on every project that has a redesign. One list, one
    //     count, and the count is of the list.
    renderTable(
      [
        permit({ id: 1 }),
        permit({ id: 2, type: 'Demolition' }),
        permit({ id: 10321, project_id: 'r-1', type: 'PPR' }),
      ],
      {
        projects: [project(), project({ id: 'r-1' })],
        redesignLabels: new Map([[10321, 'Redesign 1']]),
      },
    );
    expect(screen.getByTestId('permits-table-heading').textContent).toBe('Permits (3)');
    expect(screen.getByTestId('schedule-health-redesign-10321').textContent).toContain(
      'Redesign 1',
    );
    // ★ …and a parent permit carries no such line.
    expect(screen.queryByTestId('schedule-health-redesign-1')).toBeNull();
  });

  it('★★ fix-194: a sub-permit is neither a row nor part of n', () => {
    // Moved from `ProjectDetail.test.tsx`'s fix-194 block. The rule is fix-194's
    // and unchanged: a placeholder reviewed under its parent has no review
    // state of its own, so it is excluded from every rollup — and this table
    // has always applied `isNotSubPermit`. 3 of 685 prod permits are these.
    renderTable([permit({ id: 1 }), permit({ id: 2, parent_permit_id: 1 })]);
    expect(screen.getByTestId('permits-table-heading').textContent).toBe('Permits (1)');
    expect(screen.queryByTestId('schedule-health-row-2')).toBeNull();
  });

  it('★ the empty state names a destination that exists', () => {
    // ★ fix-517 §F sweep: it said "Add one in the Settings modal", and that
    //   modal has not existed since fix-514.
    const { container } = renderTable([]);
    expect(screen.getByTestId('permits-table-heading').textContent).toBe('Permits (0)');
    const text = container.textContent ?? '';
    expect(text).toContain('Project Details → Permits');
    expect(text).not.toContain('Settings modal');
  });
});

// ---------------------------------------------------------------------------
// §B — the columns
// ---------------------------------------------------------------------------

describe('fix-517 §B — nine columns, and Structure Address is not one', () => {
  it('★★★ Structure Address is NOT a column — it renders under the type', () => {
    // ★★★ MEASURED ON PROD, 2026-09-10: **80 of 685 permits carry a
    //     `struct_address` — 11.7%.** A column costs ~160px on every project to
    //     serve one row in eight and renders an em dash on the other seven.
    //     Bobby, second pass: *"maybe we don't need a structure address unless
    //     we put one in in the project's details."*
    renderTable([
      permit({ id: 1, struct_address: 'SFR 1' }),
      permit({ id: 2, type: 'Demolition', struct_address: null }),
    ]);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers).toHaveLength(9);
    expect(headers.join(' | ')).not.toContain('Structure Address');
    expect(headers.map((h) => h.replace(/[▲▼]/g, '').trim())).toEqual([
      'Permit Type',
      'Permit Number',
      'Reviewers',
      'Stage',
      'Permit Status',
      'Data Source',
      'Permit Approval',
      'Target Approval',
      'Schedule Health',
    ]);
    // Present on the row that has one…
    const addr = screen.getByTestId('schedule-health-addr-1');
    expect(addr.textContent).toBe('SFR 1');
    // …and inside the TYPE cell, not a cell of its own (parentage, not
    // presence — fix-422 §E).
    const typeCell = within(screen.getByTestId('schedule-health-row-1')).getAllByRole(
      'cell',
    )[0];
    expect(typeCell.contains(addr)).toBe(true);
    // Absent — not an em dash — on the row that has none.
    expect(screen.queryByTestId('schedule-health-addr-2')).toBeNull();
  });

  it('★★★ the permit number has THREE states and none of them is a dead link', () => {
    // ★★★ PROD, 2026-09-10: **587 of 685 permits have a portal URL** and **26
    //     have no number at all** (mostly NPR records). Bobby: *"some permits
    //     we don't get a number for for a while."* Absent ≠ broken.
    renderTable([
      permit({ id: 1, num: 'BP-100', portal_url: 'https://portal.example/bp100' }),
      permit({ id: 2, type: 'Demolition', num: 'DM-200', portal_url: null }),
      permit({ id: 3, type: 'IPR', num: null, portal_url: null }),
    ]);
    // (a) a number WITH a portal → a real anchor
    const link = screen.getByTestId('schedule-health-portal-1');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://portal.example/bp100');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toContain('BP-100');
    // (b) a number WITHOUT one → plain mono, never a link
    expect(screen.queryByTestId('schedule-health-portal-2')).toBeNull();
    expect(screen.getByTestId('schedule-health-num-2').tagName).toBe('SPAN');
    // (c) NO number → the rail's own words, and still no anchor anywhere
    expect(screen.getByTestId('schedule-health-nonum-3').textContent).toBe(
      'No permit # yet',
    );
    const row3 = screen.getByTestId('schedule-health-row-3');
    expect(row3.querySelector('a')).toBeNull();
  });

  it('★★★ a permit with no number STILL HAS A CLICKABLE ROW', () => {
    // §B says it twice: do not hide the row, and do not render a dead link.
    // The second is asserted above; this is the first.
    renderTable([permit({ id: 3, type: 'IPR', num: null })]);
    fireEvent.click(screen.getByTestId('schedule-health-row-3'));
    expect(selected).toEqual([3]);
  });

  it('★ the type cell carries a Building Permit’s nickname, as the rail did', () => {
    // ★ The deleted rail's `displayLabel`. Three BPs on one project were
    //   distinguishable there and were not distinguishable here.
    renderTable([permit({ id: 1, nickname: 'North' })]);
    expect(screen.getByTestId('schedule-health-type-1').textContent).toBe(
      'Building Permit — North',
    );
  });
});

// ---------------------------------------------------------------------------
// §C — order, and the one decision inside it
// ---------------------------------------------------------------------------

describe('fix-517 §C — phase is the default, urgency is one click', () => {
  it('★★★ the default order is D&E → Corrections → Permitting → Approved → Issued', () => {
    // ★★★ AND IT IS NOT `STAGE_ORDER`. `lib/pipelineDistribution`'s is
    //     `de · pm · co · ap · is` — Permitting BEFORE Corrections — and the
    //     deleted rail's phase groups read from it. Bobby's words put
    //     Corrections above Permitting: *"design and engineering is at the top
    //     and then corrections is right below that and permitting is kind of
    //     below that"*. The two surfaces disagree on purpose; the Pipeline is a
    //     funnel and this is a worklist.
    expect(PERMIT_TABLE_PHASE_ORDER).toEqual(['de', 'co', 'pm', 'ap', 'is']);
    const rows = (['is', 'pm', 'de', 'ap', 'co'] as Stage[]).map((s, i) =>
      sortRow({ id: i + 1, stage: s }),
    );
    expect(sortPermitRows(rows, 'default', 'asc').map((r) => r.stage)).toEqual([
      'de',
      'co',
      'pm',
      'ap',
      'is',
    ]);
  });

  it('★★★ ISSUED IS LAST, whatever else is in the table', () => {
    // *"issue is at the bottom"* — and "finished things sink" is the reason, so
    // it holds for any mix. Asserted as a property rather than on one fixture.
    for (const others of [['de'], ['co', 'pm'], ['de', 'co', 'pm', 'ap']] as Stage[][]) {
      const rows = [
        sortRow({ id: 99, stage: 'is', issuedIso: '2026-01-01' }),
        ...others.map((s, i) => sortRow({ id: i + 1, stage: s })),
      ];
      const out = sortPermitRows(rows, 'default', 'asc');
      expect(out[out.length - 1].stage).toBe('is');
    }
  });

  it('★★★ `projects.permit_order` is STILL READ — 13 prod projects keep their order', () => {
    // ★★★ §0.2's ANSWER, AND WHY THERE WAS NO STOP. The rail's `⠿` handles were
    //     not decorative: order is persisted in `projects.permit_order` (int[])
    //     and 13 of 219 prod projects carry a non-default one. But the rail's
    //     OUTER order was already phase and `permit_order` was only the
    //     tiebreak WITHIN a phase — which is exactly the shape §C rules. So the
    //     column is not dropped, no row is rewritten, and all 13 keep what they
    //     set. What went is the ability to RE-DRAG, because a sortable table
    //     and a manual drag order fight each other.
    const rows = [
      sortRow({ id: 10, stage: 'pm', orderRank: 2 }),
      sortRow({ id: 11, stage: 'pm', orderRank: 0 }),
      sortRow({ id: 12, stage: 'pm', orderRank: 1 }),
    ];
    expect(sortPermitRows(rows, 'default', 'asc').map((r) => r.id)).toEqual([11, 12, 10]);
    // ★ Phase still wins over it — a hand-set order cannot lift an issued
    //   permit above a live one.
    const mixed = [
      sortRow({ id: 10, stage: 'is', orderRank: 0, issuedIso: '2026-01-01' }),
      sortRow({ id: 11, stage: 'pm', orderRank: 9 }),
    ];
    expect(sortPermitRows(mixed, 'default', 'asc').map((r) => r.id)).toEqual([11, 10]);
    // ★ An un-dragged permit sorts after every dragged one, then by id — the
    //   rail's own fallback.
    const partial = [
      sortRow({ id: 20, stage: 'pm' }),
      sortRow({ id: 19, stage: 'pm' }),
      sortRow({ id: 21, stage: 'pm', orderRank: 5 }),
    ];
    expect(sortPermitRows(partial, 'default', 'asc').map((r) => r.id)).toEqual([21, 19, 20]);
  });

  it('★★ the ISSUED band keeps fix-65’s rule: most recently issued first', () => {
    const rows = [
      sortRow({ id: 1, stage: 'is', issuedIso: '2026-01-01' }),
      sortRow({ id: 2, stage: 'is', issuedIso: '2026-06-01' }),
      sortRow({ id: 3, stage: 'is', issuedIso: '2026-03-01' }),
    ];
    expect(sortPermitRows(rows, 'default', 'asc').map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('★★★ clicking `Schedule Health` gives the OVERDUE-FIRST view on ONE click', () => {
    // ★★★ THE WHOLE REASON THE HEADERS ARE SORTABLE. A first click that sorted
    //     ahead-first would need a second click to answer the question that
    //     prompted the first.
    expect(PERMIT_SORT_FIRST_DIR.health).toBe('desc');
    const rows = [
      sortRow({ id: 1, stage: 'pm', healthDiff: -5 }),
      sortRow({ id: 2, stage: 'pm', healthDiff: 40 }),
      sortRow({ id: 3, stage: 'pm', healthDiff: 12 }),
    ];
    expect(sortPermitRows(rows, 'health', 'desc').map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('★★ a missing value sorts LAST in BOTH directions', () => {
    // ★★ 26 permits have no number and a permit with no projection has no
    //    approval date. An empty cell is not "the smallest value", it is "no
    //    answer" — and no answer is never what you clicked a column to see.
    const rows = [
      sortRow({ id: 1, stage: 'pm', healthDiff: null }),
      sortRow({ id: 2, stage: 'pm', healthDiff: 40 }),
      sortRow({ id: 3, stage: 'pm', healthDiff: -5 }),
    ];
    expect(sortPermitRows(rows, 'health', 'desc').map((r) => r.id)).toEqual([2, 3, 1]);
    expect(sortPermitRows(rows, 'health', 'asc').map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it('★★ every sort falls back to the DEFAULT order, not to insertion order', () => {
    const rows = [
      sortRow({ id: 5, stage: 'is', statusLabel: 'Same', issuedIso: '2026-01-01' }),
      sortRow({ id: 6, stage: 'de', statusLabel: 'Same' }),
    ];
    expect(sortPermitRows(rows, 'status', 'asc').map((r) => r.id)).toEqual([6, 5]);
  });

  it('★★★ the header is a real BUTTON with aria-sort, and a third click resets', () => {
    renderTable([
      permit({ id: 1, expected_issue: '2026-01-01' }),
      permit({ id: 2, type: 'Demolition', expected_issue: '2027-01-01' }),
    ]);
    const th = () => screen.getByTestId('permits-sort-health').closest('th')!;
    expect(th().getAttribute('aria-sort')).toBe('none');
    // 1st click — overdue first (descending).
    fireEvent.click(screen.getByTestId('permits-sort-health'));
    expect(th().getAttribute('aria-sort')).toBe('descending');
    // 2nd — the other way.
    fireEvent.click(screen.getByTestId('permits-sort-health'));
    expect(th().getAttribute('aria-sort')).toBe('ascending');
    // 3rd — back to §C's default, so a reader is never stranded in an order
    // they cannot undo.
    fireEvent.click(screen.getByTestId('permits-sort-health'));
    expect(th().getAttribute('aria-sort')).toBe('none');
  });

  it('★★★ NO FILTER CHIPS — a decision, recorded as an assertion', () => {
    // ★★★ Bobby floated *"show me all building permits or show me all the
    //     different stages."* NOT BUILT, deliberately: **average 4 permits per
    //     project, 9 at most**, every row on screen at once. A filter control
    //     on a four-row table spends header space to hide two rows. Sortable
    //     headers yes, filters no — and §C asks for it to be said out loud so it
    //     reads as a decision rather than an omission. Revisit only if this
    //     table is ever shown across projects.
    renderTable([permit({ id: 1 }), permit({ id: 2, type: 'Demolition' })]);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    // Every button in the table is a sort header or a row's edit affordance.
    for (const b of screen.getAllByRole('button')) {
      const id = b.getAttribute('data-testid') ?? '';
      expect(
        id.startsWith('permits-sort-') ||
          id.startsWith('schedule-health-edit-') ||
          id.startsWith('reviewer-chip-'),
        `unexpected control in the table header: ${id}`,
      ).toBe(true);
    }
  });
});


// ---------------------------------------------------------------------------
// §C, RENDERED — the sort rules above are pure, and a pure rule the component
// does not read is a rule that ships broken. These two mount the real table.
// ---------------------------------------------------------------------------

describe('fix-517 §C — the TABLE reads the order, not just the module', () => {
  /** The permit ids in the order the table actually renders them. */
  function renderedIds(): number[] {
    return Array.from(document.querySelectorAll('[data-testid^="schedule-health-row-"]'))
      .map((el) => Number((el.getAttribute('data-testid') ?? '').split('-').pop()));
  }

  /** The stage word the table prints for a permit, so a fixture cannot claim a
   *  phase the deriver does not agree with. */
  function stageOf(id: number): string {
    return (
      within(screen.getByTestId(`schedule-health-row-${id}`))
        .getAllByRole('cell')[3]
        .textContent ?? ''
    ).trim();
  }

  it('★★★ RENDERED: issued sinks and corrections rises, on a real four-permit project', () => {
    // ★ Stage is DERIVED by `effectiveStage`, so these fixtures earn their
    //   stages the way prod rows do rather than declaring them:
    //     · an `actual_issue`               → issued
    //     · a cycle with `corr_issued` and no resubmit → corrections
    //     · a submitted cycle               → permitting
    //     · nothing at all                  → design & engineering
    //   And the assertion READS THE STAGE CELL BACK before trusting any of
    //   that — a fixture whose stage the deriver disagrees with would
    //   otherwise pass or fail this test for a reason that has nothing to do
    //   with the ORDER, which is what it is about.
    function cycle(permitId: number, over: Record<string, unknown> = {}) {
      return [
        {
          id: `c-${permitId}`,
          permit_id: permitId,
          cycle_index: 1,
          submitted: '2026-01-05',
          intake_accepted: '2026-01-06',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          approved: null,
          ...over,
        },
      ] as unknown as PermitWithCycles['permit_cycles'];
    }
    renderTable([
      permit({ id: 1, type: 'Demolition', actual_issue: '2026-02-01' }),
      permit({ id: 2, type: 'ULS', permit_cycles: cycle(2) }),
      permit({
        id: 3,
        type: 'Building Permit',
        permit_cycles: cycle(3, { corr_issued: '2026-03-01' }),
      }),
      permit({ id: 4, type: 'PAR/Pre-Sub' }),
    ]);
    // The deriver's own verdict, first — four distinct phases.
    // ★ `STAGE_LABEL`'s own words — the short form, which is what this cell
    //   has printed since fix-104 and what the deleted rail's breadcrumb used.
    expect([stageOf(4), stageOf(3), stageOf(2), stageOf(1)]).toEqual([
      'D&E',
      'Corrections',
      'Permitting',
      'Issued',
    ]);
    // …and THEN the order, which is what this test exists for.
    const ids = renderedIds();
    expect(ids).toEqual([4, 3, 2, 1]);
    // ★★ The two halves of Bobby's ask, stated separately so a failure says
    //    which one broke.
    expect(ids[ids.length - 1]).toBe(1);
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(2));
  });

  it('★★★ RENDERED: `projects.permit_order` still orders within a phase', () => {
    // ★★★ THE END-TO-END PROOF OF §0.2. The comparator honouring `orderRank` is
    //     worth nothing if the component never reads the column — which is a
    //     four-place trap this repo has recorded before (fix-410: a new
    //     `projects` column needs the column, both RPCs and `useProjects`'s
    //     explicit select list, and three of the four fail SILENTLY).
    //     `permit_order` IS on that select list; this proves the table uses it.
    renderTable(
      [
        permit({ id: 10, type: 'Building Permit' }),
        permit({ id: 11, type: 'Demolition' }),
        permit({ id: 12, type: 'ULS' }),
      ],
      { projects: [project({ permit_order: [12, 10, 11] as unknown as number[] })] },
    );
    expect(renderedIds()).toEqual([12, 10, 11]);
  });

  it('★★★ RENDERED: clicking `Schedule Health` re-sorts the rows overdue-first', () => {
    // Three permits with the same (D&E) phase and different targets, so the
    // DEFAULT order cannot accidentally produce the sorted one: with no
    // `permit_order` the default is id-ascending, and the answer is not.
    // ★ A health diff needs BOTH a projection and a target. `approval_date`
    //   short-circuits the projection to a real date (and puts all three in the
    //   same `ap` phase, so the DEFAULT order cannot accidentally produce the
    //   sorted one — with no `permit_order` the default is id-ascending, and
    //   the answer is not).
    renderTable([
      permit({
        id: 1,
        type: 'Building Permit',
        approval_date: '2026-06-01',
        expected_issue: '2030-01-01',
      }),
      permit({
        id: 2,
        type: 'Demolition',
        approval_date: '2026-06-01',
        expected_issue: '2020-01-01',
      }),
      permit({
        id: 3,
        type: 'ULS',
        approval_date: '2026-06-01',
        expected_issue: '2025-01-01',
      }),
    ]);
    expect(renderedIds()).toEqual([1, 2, 3]);
    fireEvent.click(screen.getByTestId('permits-sort-health'));
    // The earliest target is the most overdue, so it comes first.
    expect(renderedIds()).toEqual([2, 3, 1]);
  });
});

// ---------------------------------------------------------------------------
// §D — clicking a row
// ---------------------------------------------------------------------------

describe('fix-517 §D — the row is the control, with two exceptions', () => {
  it('★★★ a row click opens the Permit View, as a rail row did', () => {
    renderTable([permit({ id: 1 }), permit({ id: 2, type: 'Demolition' })]);
    fireEvent.click(screen.getByTestId('schedule-health-row-2'));
    expect(selected).toEqual([2]);
  });

  it('★★★ clicking the HYPERLINK opens the portal and does NOT navigate', () => {
    renderTable([permit({ id: 1, num: 'BP-1', portal_url: 'https://portal.example/1' })]);
    fireEvent.click(screen.getByTestId('schedule-health-portal-1'));
    expect(selected).toEqual([]);
  });

  it('★★★ clicking the REVIEWERS cell does NOT navigate', () => {
    // ★ The whole CELL swallows it, not just the chip: the popover trigger is
    //   inside a component this table does not own, and a chip that grew a
    //   second control would silently start navigating.
    renderTable([permit({ id: 1 })]);
    fireEvent.click(screen.getByTestId('reviewer-chip-1'));
    expect(selected).toEqual([]);
    fireEvent.click(screen.getByTestId('schedule-health-reviewers-1'));
    expect(selected).toEqual([]);
  });

  it('★★ every OTHER cell navigates — the exceptions are two, not "several"', () => {
    renderTable([permit({ id: 1, num: 'BP-1', portal_url: 'https://p.example/1' })]);
    const cells = within(screen.getByTestId('schedule-health-row-1')).getAllByRole('cell');
    // Cells 0 and 3..8 navigate. 1 is the hyperlink cell (the anchor stops it,
    // not the cell — a click on the cell's padding is still a row click) and 2
    // is Reviewers.
    for (const i of [0, 3, 4, 5, 6, 7, 8]) {
      selected.length = 0;
      fireEvent.click(cells[i]);
      expect(selected, `cell ${i} should navigate`).toEqual([1]);
    }
    selected.length = 0;
    fireEvent.click(cells[2]);
    expect(selected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §E — Quick Edit Permit is deleted
// ---------------------------------------------------------------------------

describe('fix-517 §E — one permit editor, reached from the row', () => {
  it('★★★ `QuickEditPermitModal` does not exist', () => {
    // ★★★ *"A surviving modal is what produced fix-514 in the first place."*
    //     Deleted BY PATH, with its test, the way fix-514 deleted
    //     `ProjectSettingsModal`.
    const files = Object.keys(
      import.meta.glob('../components/ProjectDetail/*.tsx', { eager: false }),
    );
    expect(files.some((f) => f.includes('QuickEditPermitModal'))).toBe(false);
    const tests = Object.keys(import.meta.glob('./*.test.tsx', { eager: false }));
    expect(tests.some((f) => f.includes('QuickEditPermitModal'))).toBe(false);
    expect(pageSrc).not.toContain(
      "from '../components/ProjectDetail/QuickEditPermitModal'",
    );
  });

  it('★★★ the edit affordance is a HOVER control, not a double-click', () => {
    // ★★★ Bobby floated double-tap. NOT USED: single-click already opens the
    //     Permit View (§D), so single=view / double=edit is a coin flip, and
    //     double-click fights text selection in a table.
    renderTable([permit({ id: 7 })]);
    const btn = screen.getByTestId('schedule-health-edit-7');
    expect(btn.className).toContain('opacity-0');
    expect(btn.className).toContain('group-hover:opacity-100');
    // Reachable by keyboard too — a hover-only control is invisible to one.
    expect(btn.className).toContain('focus:opacity-100');
    expect(btn.getAttribute('aria-label')).toContain('Project Details');
    expect(tableSrc).not.toContain('onDoubleClick');
  });

  it('★★★ fix-519 §D (P-232) — the glyph CARRIES the navigation, and says where', () => {
    // ★★★ SUPERSEDING fix-517's BARE ✎. The behaviour was already right — this
    //     control opens Project Details and always did — but **Bobby still had
    //     to ask whether the rule had been broken**, because a pencil is the
    //     universal sign for EDIT IN PLACE. When a ruling changes what a
    //     control does, the control's SIGN changes with it, or the ruling reads
    //     as broken. Nothing about the click changed.
    renderTable([permit({ id: 7 })]);
    const btn = screen.getByTestId('schedule-health-edit-7');
    // The arrow is decorative — the accessible name is the sentence.
    expect(btn.textContent).toContain('↗');
    expect(btn.getAttribute('title')).toBe('Edit in Project Details');
    expect(btn.getAttribute('aria-label')).toContain('in Project Details');
    // ★ The destination is NAMED, not merely implied by an icon: a screen
    //   reader hearing "Edit" alone learns nothing about the page changing.
    expect(btn.querySelector('[aria-hidden="true"]')?.textContent).toBe('↗');
  });

  it('★★★ it targets the Permits tab, and does not also open the Permit View', () => {
    renderTable([permit({ id: 7 })]);
    fireEvent.click(screen.getByTestId('schedule-health-edit-7'));
    expect(edited).toEqual([7]);
    expect(selected).toEqual([]);
  });

  it('★★★ the deep link reuses fix-514 §C’s parameter and does NOT reuse `?permit=`', () => {
    // ★★★ `?permit=` ALREADY MEANS SOMETHING ELSE — ProjectDetail reads it to
    //     select a permit and swap the overview pane for the Permit View
    //     (fix-217/218/219). Reusing it would open the modal over a page that
    //     had silently navigated away underneath it.
    expect(pageSrc).toContain("next.set(PARAM_DATA, 'permits')");
    expect(pageSrc).toContain('next.set(PARAM_DATA_FOCUS, String(permitId))');
    // ★ …and closing the modal clears the focus, so it cannot re-fire.
    expect(pageSrc).toContain('next.delete(PARAM_DATA_FOCUS)');
  });

  it('★★★ `Sub-permit of` is editable in the Permits tab, on fix-194’s rules', () => {
    // ★★★ **3 of 685 prod permits are sub-permits.** Cheap, and §E is explicit
    //     that it must not be dropped silently: fix-194's marker excludes a
    //     permit from every rollup, so an uneditable one is permanently
    //     mis-counted with no way back. It was `QuickEditPermitModal`'s only
    //     unique field.
    expect(formSrc).toContain('Sub-permit of');
    expect(formSrc).toContain('parent_permit_id');
    // fix-194's three candidate rules, unchanged: not itself, not already a
    // sub-permit, and (because this form holds one project) same project.
    expect(formSrc).toContain('p.id !== row.id');
    expect(formSrc).toContain('!p.parent_permit_id.trim()');
  });
});

// ---------------------------------------------------------------------------
// §F — P-223, both directions
// ---------------------------------------------------------------------------

describe('fix-517 §F — the rename sweep', () => {
  it('★★★ this table names Project Details, never Project Data or Settings', () => {
    // ★★★ THE SWEEP CAUGHT THIS ONE. `Target Approval`'s tooltip said *"Edit
    //     the ACQ date in Project Data"* — a retired name, and wrong twice
    //     over: fix-514 §G moved the ACQ date to the PERMITS tab, per permit.
    const src = tableSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain('Project Data.');
    expect(src).not.toContain('Project Settings');
    expect(src).toContain('Project Details → Permits');
  });
});

// ---------------------------------------------------------------------------
// The comparator, directly
// ---------------------------------------------------------------------------

describe('fix-517 — defaultComparePermits is total and stable', () => {
  it('★ equal rows compare 0, and the order is antisymmetric', () => {
    const a = sortRow({ id: 1, stage: 'pm', orderRank: 0 });
    const b = sortRow({ id: 2, stage: 'pm', orderRank: 1 });
    expect(defaultComparePermits(a, a)).toBe(0);
    expect(Math.sign(defaultComparePermits(a, b))).toBe(
      -Math.sign(defaultComparePermits(b, a)),
    );
  });

  it('★ an unknown stage sorts last rather than throwing', () => {
    // fix-406's lesson: removing a value from a union does not stop a stored
    // string arriving.
    const rows = [
      sortRow({ id: 1, stage: 'zz' as Stage }),
      sortRow({ id: 2, stage: 'de' }),
    ];
    expect(sortPermitRows(rows, 'default', 'asc').map((r) => r.id)).toEqual([2, 1]);
  });
});
