import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { PermitWithCycles, Project } from '../lib/database.types';
import {
  ALL_METRIC_DEFINITIONS,
  REDESIGNS_CYCLE_COMPARISON,
  REPORTS_OVERVIEW_METRICS,
  TEAM_DETAIL_PHASE_METRICS,
} from '../lib/metricDefinitions';
import { METRIC_DRILLINS } from '../lib/metricDrillIn';
import { CSV_HEADERS, exportEnrichedPermitsToCSV } from '../lib/csvExport';
import type { EnrichedPermit } from '../lib/reportMetrics';
import { shownDate } from '../test/milestoneDate';

// ★ fix-310 — one concept, one name. DD wins.
//
// fix-296b renamed the reporting metrics DD -> Draw on the principle "name it
// after what it measures". fix-309 #52 then renamed the thing they measure to
// DD start / DD end, matching the schema, which has always said dd_start /
// dd_end. The anchor moved and the metrics stayed behind, so one concept had
// two names again. This closes it on DD.
//
// It is NOT a reversal of fix-296b — it is fix-296b's own rule applied a second
// time, after the thing being named changed. Do not flip it back.
//
// This file guards the three things a rename can break:
//   1. the labels actually changed, at their own surfaces;
//   2. ★ NOTHING KEYED OFF A LABEL. Metric keys, testIds and the write path are
//      untouched — a rename that breaks a saved report is a data incident;
//   3. ★ the Draw SCHEDULE, a different concept, kept its name.

// ---------------------------------------------------------------------------
// 1. The labels changed
// ---------------------------------------------------------------------------

describe('fix-310: every renamed surface says DD', () => {
  it('the metric definitions', () => {
    expect(TEAM_DETAIL_PHASE_METRICS.avgDdDays!.label).toBe('DD');
    expect(REDESIGNS_CYCLE_COMPARISON.ddPhase!.label).toBe('DD');
    expect(REPORTS_OVERVIEW_METRICS.avgDDDuration!.label).toBe('Avg DD Duration');
    expect(REPORTS_OVERVIEW_METRICS.avgGoToDDStart!.label).toBe('Avg GO → DD Start');
    expect(REPORTS_OVERVIEW_METRICS.avgDDEndToSubmit!.label).toBe('Avg DD → Submit');
  });

  it('the drill-in date rows', () => {
    const enriched = {
      permit: { dd_start: '2026-01-01', dd_end: '2026-01-11' },
    } as unknown as EnrichedPermit;
    expect(
      METRIC_DRILLINS.avgDDDuration!.dates(enriched).map((d) => d.label),
    ).toEqual(['DD Start', 'DD End']);
  });

  it('the CSV headers', () => {
    expect(CSV_HEADERS).toContain('DD Duration (d)');
    expect(CSV_HEADERS).toContain('DD End → Submit (d)');
  });

  // ★ The sweep, not a hand-list. Every string a user can read out of the
  // metric registry, checked for the Draw vocabulary in one pass.
  it('and no metric definition anywhere still carries the Draw vocabulary', () => {
    for (const [key, def] of Object.entries(ALL_METRIC_DEFINITIONS)) {
      const surfaced = [def.label, def.description, def.cohort ?? ''].join(' ');
      expect(surfaced, `${key}`).not.toMatch(/Draw Start|Draw End|Draw Duration/i);
      // A bare "Draw" as a name for this concept. "Draw Schedule" is a
      // different thing and is allowed through; "started drawing" is the
      // activity, not a name, and is not matched by \bDraw\b.
      expect(surfaced, `${key}`).not.toMatch(/\bDraw\b(?! Schedule)/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. ★ Nothing keyed off a label
// ---------------------------------------------------------------------------

// This is the section that protects saved reports. A saved report stores the
// metric KEY; if a copy change moved a key, every stored configuration
// referencing it would silently resolve to nothing.
describe('fix-310: the rename touched no identifier', () => {
  it('every metric still resolves by the key it had before', () => {
    // Named explicitly rather than iterated — an iteration over the object
    // would pass even if a key had been renamed, since it reads its own output.
    // ALL_METRIC_DEFINITIONS namespaces by surface (reports.*, team.* ...); the
    // per-surface keys below are the ones a saved report actually stores.
    for (const key of [
      'reports.avgDDDuration',
      'reports.avgGoToDDStart',
      'reports.avgDDEndToSubmit',
      'reports.totalPermits',
      'team.avgDdDays',
    ]) {
      expect(ALL_METRIC_DEFINITIONS[key], `metric key ${key} disappeared`).toBeTruthy();
    }
    for (const key of ['avgDDDuration', 'avgGoToDDStart', 'avgDDEndToSubmit']) {
      expect(REPORTS_OVERVIEW_METRICS[key], `overview key ${key} disappeared`).toBeTruthy();
    }
    expect(TEAM_DETAIL_PHASE_METRICS.avgDdDays).toBeTruthy();
    expect(REDESIGNS_CYCLE_COMPARISON.ddPhase).toBeTruthy();
    expect(METRIC_DRILLINS.avgDDDuration).toBeTruthy();
    expect(METRIC_DRILLINS.avgGoToDDStart).toBeTruthy();
  });

  it('the formula and cohort lines still describe dd_start / dd_end', () => {
    // The DB vocabulary was never "Draw" and is not "DD Start" either — it is
    // the column names, and they are what the formula must keep quoting.
    expect(TEAM_DETAIL_PHASE_METRICS.avgDdDays!.formula).toContain('dd_end − dd_start');
    expect(REPORTS_OVERVIEW_METRICS.avgDDDuration!.formula).toBe(
      'avg(dd_end − dd_start) in days',
    );
    expect(REPORTS_OVERVIEW_METRICS.avgDDDuration!.cohort).toBe(
      'Only counts permits with both dd_start AND dd_end set.',
    );
  });

  // ★ The CSV header says DD; the value under it still comes from the same
  // EnrichedPermit field. Header and identifier move independently.
  it('a CSV export carries the DD headers over unchanged column identifiers', () => {
    const created: Record<string, unknown> = {};
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    let captured = '';
    // Capture the blob rather than downloading it.
    URL.createObjectURL = ((blob: Blob) => {
      created.blob = blob;
      return 'blob:stub';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const row = {
      permit: {
        type: 'Building Permit',
        num: 'BP-1',
        stage: 'is',
        stage_override: null,
        ent_lead: null,
        da: null,
        dm: null,
        architect: null,
        target_submit: null,
        expected_issue: null,
        approval_date: null,
        actual_issue: null,
        corr_rounds: 0,
      },
      address: '1 Main St',
      juris: 'Seattle',
      goDate: null,
      firstSubmitted: null,
      firstIntakeAccepted: null,
      goToSubmit: null,
      // ★ THE POINT: the identifiers are ddDuration / ddEndToSubmit, and they
      // did not move when the header words did.
      ddDuration: 10,
      ddEndToSubmit: 4,
      submitToIntake: null,
      permitTimelineDays: null,
      variance: null,
      units: 1,
    } as unknown as EnrichedPermit;

    const out = exportEnrichedPermitsToCSV([row], 'test.csv');
    expect(out.rowsExported).toBe(1);

    return (created.blob as Blob).text().then((text) => {
      captured = text;
      const [header, body] = captured.split('\n');
      expect(header).toContain('"DD Duration (d)"');
      expect(header).toContain('"DD End → Submit (d)"');
      expect(header).not.toContain('Draw');
      // The values arrived under those headers from the untouched fields.
      const cols = header!.split(',');
      const cells = body!.split(',');
      expect(cells[cols.indexOf('"DD Duration (d)"')]).toBe('"10d"');
      expect(cells[cols.indexOf('"DD End → Submit (d)"')]).toBe('"4d"');

      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      clickSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. ★ The Draw Schedule is a different concept and kept its name
// ---------------------------------------------------------------------------

describe('fix-310: the sweep did not eat the Draw Schedule', () => {
  it('the DrawSchedule modules are still there under their own names', async () => {
    // Imported for real, not string-matched: a rename would fail the import.
    const helpers = await import('../lib/drawScheduleHelpers');
    expect(typeof helpers).toBe('object');
    const quarter = await import('../lib/quarterLayoutHelpers');
    expect(typeof quarter.buildDrawColumns).toBe('function');
  });

  it('the vendor report still describes draw BLOCKS, which are schedule rows', async () => {
    const { builtinReportHowItWorks } = await import('../lib/builtinReports');
    const how = builtinReportHowItWorks('vendor_schedule_forecast');
    expect(how).toBeTruthy();
    const all = JSON.stringify(how);
    // The block is a Draw Schedule row and keeps the word...
    expect(all).toMatch(/draw block/i);
    // ...while the DD-phase DATE in the same copy has been renamed.
    expect(all).toContain('(DD End)');
    expect(all).not.toContain('(Draw End)');
  });
});

// ---------------------------------------------------------------------------
// 4. The write path still writes
// ---------------------------------------------------------------------------

const ddMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useSetBpDdDates', () => ({
  useSetBpDdDates: () => ({ mutateAsync: ddMutateAsync, isPending: false }),
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpdateRedesignDdPhase', () => ({
  useUpdateRedesignDdPhase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
const drawRowsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: drawRowsRef.current, isLoading: false }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ map: new Map() }),
  readAppConfigStringArray: () => [] as string[],
  readConsultantTypes: () => [] as { type: string; firms: string[] }[],
}));
vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertDirectoryFirm: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePlanOfRecord', () => ({
  usePlanOfRecord: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  usePlanOfRecordThumbnail: () => ({ data: null, isLoading: false, error: null }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

const ProjectDetailHeader = (await import('../components/ProjectDetail/ProjectDetailHeader'))
  .default;

const T = 'test-tenant-uuid';

function renderHeader() {
  const project = {
    id: 'p-310',
    address: '6605 57th Ave NE',
    juris: 'Seattle',
    archived: false,
    external_team: {},
    permit_order: [],
    go_date: '2026-06-05',
    product_types: [],
    created_at: '2026-05-15T12:00:00Z',
    updated_at: '2026-05-15T12:00:00Z',
  } as unknown as Project;
  const bp = {
    id: 100,
    project_id: 'p-310',
    type: 'Building Permit',
    num: 'BP-100',
    da: 'Ainsley',
    dd_start: null,
    dd_end: null,
    target_submit: null,
    target_submit_is_manual: false,
    created_at: '2026-05-15T12:00:00Z',
    updated_at: '2026-05-14T09:00:00Z',
    permit_cycles: [],
  } as unknown as PermitWithCycles;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectDetailHeader project={project} permits={[bp]} bp={bp} />,
    { wrapper },
  );
}

beforeEach(() => {
  ddMutateAsync.mockReset();
  ddMutateAsync.mockResolvedValue({ overlapKind: null });
  drawRowsRef.current = [
    {
      project_id: 'p-310',
      da_assigned: 'Ainsley',
      updated_at: '2026-05-14T09:00:00Z',
      start_week: '2026-06-01',
      end_week: '2026-07-03',
    },
  ];
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: 'u', email: 'u@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

describe('fix-310: the DD dates still write, and the section is renamed', () => {
  it('the Milestones card section reads DD window', () => {
    renderHeader();
    const card = screen.getByTestId('pd-milestones-card');
    expect(within(card).getByText('DD window')).toBeInTheDocument();
    expect(within(card).queryByText('Draw window')).toBeNull();
  });

  // ★ Assert the WRITE, not the label — the same discipline as fix-296b and
  // fix-309 #52. The testIds are the DB vocabulary and never move.
  it('and writing them still calls through with ddStart / ddEnd', async () => {
    renderHeader();
    const start = screen.getByTestId('pd-bp-dd_start') as HTMLInputElement;
    const end = screen.getByTestId('pd-bp-dd_end') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-06-01' } });
    fireEvent.change(end, { target: { value: '2026-07-03' } });
    fireEvent.blur(end);

    await waitFor(() => expect(ddMutateAsync).toHaveBeenCalled());
    const arg = ddMutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toHaveProperty('ddStart');
    expect(arg).toHaveProperty('ddEnd');
    expect(arg.ddStart).toBe('2026-06-01');
    expect(Object.keys(arg).join(',')).not.toMatch(/draw/i);
  });

  // fix-309's contracts, spot-checked on the same render so a nomenclature
  // sweep cannot have quietly disturbed the layout it renamed into.
  it('fix-309 survives: Key dates is GO then Closing, and SD sits above DD', () => {
    renderHeader();
    const card = screen.getByTestId('pd-milestones-card');
    const keyDates = within(card).getByText('Key dates').parentElement as HTMLElement;
    const text = keyDates.textContent ?? '';
    expect(text.indexOf('GO Date')).toBeLessThan(text.indexOf('Closing'));

    const start = screen.getByTestId('pd-bp-dd_start') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-06-01' } });
    // ★ fix-311 split the one combined `start → end` string into two rows so SD
    // sits parallel with DD start / DD end. Same derived window, same two dates.
    expect(screen.getByTestId('pd-sd-start')).toHaveTextContent(shownDate('2026-05-04'));
    expect(screen.getByTestId('pd-sd-end')).toHaveTextContent(shownDate('2026-06-01'));
    const cardText = card.textContent ?? '';
    expect(cardText.indexOf('SD')).toBeLessThan(cardText.indexOf('DD start'));
  });
});
