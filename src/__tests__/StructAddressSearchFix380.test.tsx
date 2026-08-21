import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ===========================================================================
// fix-380 — a permit's own address finds nothing (structure-address search)
// ===========================================================================
//
// Bobby: "Sometimes the project gets an address, but then the individual
// building permits might get a separate address. Maybe I don't know the
// project by the project address, but I know it by the structure address."
//
// ★★★ THE KEY SEMANTIC: a structure address finds the PROJECT. Project-level
// surfaces match when ANY of the project's permits' struct_address matches.
// Permit-level surfaces match on their own permit's struct_address.
//
// Measured on prod 2026-08-21: 70 of 588 permits carry a struct_address, 67
// differ from their project's address; 518 carry none (the null path is the
// COMMON case). Real shape: 10401/10411 NE 60th St — one project, an ADU
// with its own address — reproduced in the fixtures below.
//
// Surfaces covered here: the pipeline (rendered Dashboard), Project List
// (projectViewHelpers), Library (libraryHelpers), Reports (reportMetrics),
// Reuse picker (reuseSourceHelpers), and the shared haystack helper. The
// draw schedule is asserted in DrawScheduleGrid.test.tsx and My Tasks in
// MyTasks.test.tsx, each on its own existing harness.

import { structAddressHaystack } from '../lib/structAddressSearch';
import {
  buildProjectRows,
  filterProjectRows,
  DEFAULT_FILTERS as PV_DEFAULT_FILTERS,
} from '../lib/projectViewHelpers';
import {
  buildLibraryRows,
  filterLibraryRows,
  type LibraryFilters,
} from '../lib/libraryHelpers';
import {
  buildReuseSources,
  filterReuseSources,
} from '../components/wizard/reuseSourceHelpers';
import {
  enrichPermits,
  filterEnrichedPermits,
  type ReportFilters,
} from '../lib/reportMetrics';
import type {
  PermitWithCycles,
  Project,
} from '../lib/database.types';

// ---------------------------------------------------------------------------
// Shared fixtures — the real 10401/10411 shape.
// ---------------------------------------------------------------------------
function makePermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p-adu',
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
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
    updated_at: '2026-01-01T00:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p-adu',
    address: '10401 NE 60th St',
    juris: 'Kirkland',
    archived: false,
    notes: null,
    ...over,
  };
}

/** The real shape: the project is 10401; its ADU permit is 10411. */
const ADU_PROJECT = makeProject({ id: 'p-adu', address: '10401 NE 60th St' });
const ADU_PERMIT = makePermit({
  id: 11,
  project_id: 'p-adu',
  struct_address: '10411 NE 60th St',
});
/** 518 of 588: a permit with NO struct_address. */
const PLAIN_PROJECT = makeProject({ id: 'p-plain', address: '750 Oak Way' });
const PLAIN_PERMIT = makePermit({ id: 12, project_id: 'p-plain' });

// ---------------------------------------------------------------------------
describe('fix-380 — structAddressHaystack (the one shared concept)', () => {
  it('joins the non-empty, trimmed struct addresses', () => {
    expect(
      structAddressHaystack([
        { struct_address: ' 10411 NE 60th St ' },
        { struct_address: null },
        { struct_address: 'Cottage 2' },
      ]),
    ).toBe('10411 NE 60th St Cottage 2');
  });

  it('★★ null-safe: no list, empty list, and all-null lists contribute NOTHING', () => {
    expect(structAddressHaystack(null)).toBe('');
    expect(structAddressHaystack(undefined)).toBe('');
    expect(structAddressHaystack([])).toBe('');
    expect(structAddressHaystack([{ struct_address: null }, {}])).toBe('');
    // '' — not ' ' or a joined empty token — so a null can never match the
    // empty string or pad another surface's haystack.
    expect(structAddressHaystack([{ struct_address: '   ' }])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE PIPELINE (rendered Dashboard) — a struct_address finds the PROJECT.
// Harness mirrors DashboardCancelled.test.tsx.
// ---------------------------------------------------------------------------
const projectsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const permitsRef = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: projectsRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: permitsRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useNumberEntrySweep', () => ({
  useNumberEntrySweep: () => undefined,
}));
vi.mock('../components/NewProjectWizard', () => ({ default: () => null }));
vi.mock('../hooks/useSelfScope', () => ({
  useScopeMode: () => ({
    mode: 'all',
    setMode: vi.fn(),
    identity: { name: null, scope: 'all' },
    ready: true,
  }),
}));
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

import Dashboard from '../pages/Dashboard';

function cycle() {
  return {
    id: 'c1',
    permit_id: 0,
    cycle_index: 1,
    submitted: '2026-05-01',
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

/** A permit that lands in the "Under Review" sub-bucket, Dashboard-shaped. */
function dashPermit(over: Record<string, unknown>) {
  return {
    ...makePermit({ status: 'Reviews In Process' }),
    permit_cycles: [cycle()],
    extras: null,
    parent_permit_id: null,
    corr_issued: null,
    ...over,
  };
}

function renderDash() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Dashboard />, { wrapper });
}

function renderedAddresses(): string[] {
  return screen
    .queryAllByTestId(/^addr-group-/)
    .map((el) => el.getAttribute('data-addr') ?? '')
    .filter(Boolean);
}

function searchBox(): HTMLElement {
  return screen.getByPlaceholderText(/Search address, DA, ENT, juris, num/);
}

beforeEach(() => {
  projectsRef.current = [
    { id: 'p-adu', address: '10401 NE 60th St', juris: 'Kirkland' },
    { id: 'p-plain', address: '750 Oak Way', juris: 'Bellevue' },
  ];
  permitsRef.current = [
    dashPermit({ id: 11, project_id: 'p-adu', struct_address: '10411 NE 60th St' }),
    dashPermit({ id: 12, project_id: 'p-plain', struct_address: null }),
  ];
});

describe('fix-380 §1 — the pipeline: a structure address finds the PROJECT', () => {
  it('★★★ searching the ADU struct_address surfaces the project whose permit carries it', () => {
    renderDash();
    fireEvent.change(searchBox(), { target: { value: '10411' } });
    expect(renderedAddresses()).toEqual(['10401 NE 60th St']);
  });

  it('★ project-address search still works exactly as before', () => {
    renderDash();
    fireEvent.change(searchBox(), { target: { value: '10401' } });
    expect(renderedAddresses()).toEqual(['10401 NE 60th St']);
    fireEvent.change(searchBox(), { target: { value: 'oak' } });
    expect(renderedAddresses()).toEqual(['750 Oak Way']);
  });

  it('★★ a permit with NO struct_address neither matches nor breaks anything', () => {
    renderDash();
    // Both projects render with no search…
    fireEvent.change(searchBox(), { target: { value: '' } });
    expect(renderedAddresses().sort()).toEqual(['10401 NE 60th St', '750 Oak Way']);
    // …and a struct-only term never reaches the null-struct project.
    fireEvent.change(searchBox(), { target: { value: '10411' } });
    expect(renderedAddresses()).not.toContain('750 Oak Way');
  });

  it('★ case + whitespace behave like the existing search (tokens AND, case-folded)', () => {
    renderDash();
    fireEvent.change(searchBox(), { target: { value: '  10411,ne ' } });
    expect(renderedAddresses()).toEqual(['10401 NE 60th St']);
    // A token that hits neither address nor struct still excludes.
    fireEvent.change(searchBox(), { target: { value: '10411 zzz' } });
    expect(renderedAddresses()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Project List (projectViewHelpers) — project-level.
// ---------------------------------------------------------------------------
const baseViewFilters = PV_DEFAULT_FILTERS;

describe('fix-380 §2 — Project List rows match on their permits struct_address', () => {
  const rows = buildProjectRows(
    [ADU_PROJECT, PLAIN_PROJECT],
    [ADU_PERMIT, PLAIN_PERMIT],
    [],
  );

  it('a struct_address search finds the project row', () => {
    const out = filterProjectRows(rows, { ...baseViewFilters, search: '10411' });
    expect(out.map((r) => r.project.id)).toEqual(['p-adu']);
  });

  it('project-address search unchanged; null-struct projects unaffected', () => {
    expect(
      filterProjectRows(rows, { ...baseViewFilters, search: 'oak' }).map(
        (r) => r.project.id,
      ),
    ).toEqual(['p-plain']);
    expect(
      filterProjectRows(rows, { ...baseViewFilters, search: '' }).map(
        (r) => r.project.id,
      ),
    ).toEqual(['p-adu', 'p-plain']);
  });

  it('★ a struct_address on a SUB-permit still finds the project (ANY permit, fix-194 subs included)', () => {
    const sub = makePermit({
      id: 13,
      project_id: 'p-plain',
      parent_permit_id: 12,
      struct_address: 'Cottage 4',
    } as Partial<PermitWithCycles>);
    const withSub = buildProjectRows(
      [ADU_PROJECT, PLAIN_PROJECT],
      [ADU_PERMIT, PLAIN_PERMIT, sub],
      [],
    );
    const out = filterProjectRows(withSub, {
      ...baseViewFilters,
      search: 'cottage',
    });
    expect(out.map((r) => r.project.id)).toEqual(['p-plain']);
  });
});

// ---------------------------------------------------------------------------
// Library (libraryHelpers) — Bobby named it.
// ---------------------------------------------------------------------------
const baseLibFilters: LibraryFilters = {
  search: '',
  lotwTarget: null,
  lotwBuf: 0,
  lotdTarget: null,
  lotdBuf: 0,
  unitwTarget: null,
  unitwBuf: 0,
  unitdTarget: null,
  unitdBuf: 0,
  stories: '',
  zone: '',
  alley: '',
  productTypes: [],
  tag: '',
  juris: '',
  numLots: null,
  isCornerLot: '',
};

describe('fix-380 §3 — the Library matrix matches on struct_address', () => {
  const rows = buildLibraryRows(
    [ADU_PROJECT, PLAIN_PROJECT],
    [ADU_PERMIT, PLAIN_PERMIT],
  );

  it('a struct_address search finds the project row; address search unchanged', () => {
    expect(
      filterLibraryRows(rows, { ...baseLibFilters, search: '10411' }).map(
        (r) => r.projectId,
      ),
    ).toEqual(['p-adu']);
    expect(
      filterLibraryRows(rows, { ...baseLibFilters, search: 'oak' }).map(
        (r) => r.projectId,
      ),
    ).toEqual(['p-plain']);
    expect(
      filterLibraryRows(rows, { ...baseLibFilters, search: '' }).map(
        (r) => r.projectId,
      ),
    ).toEqual(['p-adu', 'p-plain']);
  });

  it('★ a fixture row WITHOUT the new field behaves byte-identically (optional field)', () => {
    const legacyRow = { ...rows[1] };
    delete (legacyRow as { structAddressHay?: string }).structAddressHay;
    expect(
      filterLibraryRows([legacyRow], { ...baseLibFilters, search: 'oak' }),
    ).toHaveLength(1);
    expect(
      filterLibraryRows([legacyRow], { ...baseLibFilters, search: '10411' }),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reports (reportMetrics) — a PERMIT-level surface: the row matches on its
// own struct_address.
// ---------------------------------------------------------------------------
const baseReportFilters: ReportFilters = {
  types: new Set(),
  jurisdictions: new Set(),
  ents: new Set(),
  productTypes: new Set(),
  tags: new Set(),
  range: 'all',
  dateFrom: null,
  dateTo: null,
  status: 'all',
  permitStatus: 'all',
  search: '',
  comparisonRange: null,
};

describe('fix-380 §4 — Reports rows match on their own struct_address', () => {
  const projectsById = new Map<string, Project>([
    ['p-adu', ADU_PROJECT],
    ['p-plain', PLAIN_PROJECT],
  ]);
  const enriched = enrichPermits([ADU_PERMIT, PLAIN_PERMIT], projectsById);

  it('a struct_address search finds the permit row', () => {
    const out = filterEnrichedPermits(enriched, {
      ...baseReportFilters,
      search: '10411',
    });
    expect(out.map((e) => e.permit.id)).toEqual([11]);
  });

  it('address search unchanged; null struct_address matches nothing extra', () => {
    expect(
      filterEnrichedPermits(enriched, { ...baseReportFilters, search: 'oak' }).map(
        (e) => e.permit.id,
      ),
    ).toEqual([12]);
    expect(
      filterEnrichedPermits(enriched, { ...baseReportFilters, search: '' }).map(
        (e) => e.permit.id,
      ),
    ).toEqual([11, 12]);
  });
});

// ---------------------------------------------------------------------------
// Reuse source picker (fix-216) — a plan Bobby knows by its structure address.
// ---------------------------------------------------------------------------
describe('fix-380 §5 — the Reuse picker matches on struct_address', () => {
  const sources = buildReuseSources(
    [ADU_PROJECT, PLAIN_PROJECT],
    new Map([
      ['p-adu', [ADU_PERMIT]],
      ['p-plain', [PLAIN_PERMIT]],
    ]),
  );

  it('finds the plan by its permit struct_address; address search unchanged', () => {
    expect(filterReuseSources(sources, '10411').map((s) => s.id)).toEqual(['p-adu']);
    expect(filterReuseSources(sources, 'oak').map((s) => s.id)).toEqual(['p-plain']);
    expect(filterReuseSources(sources, '').map((s) => s.id)).toEqual([
      'p-adu',
      'p-plain',
    ]);
  });

  it('★ a source without the field (older fixture) behaves as before', () => {
    const legacy = sources.map((s) => {
      const c = { ...s };
      delete (c as { structAddressHay?: string }).structAddressHay;
      return c;
    });
    expect(filterReuseSources(legacy, '10411')).toHaveLength(0);
    expect(filterReuseSources(legacy, 'oak')).toHaveLength(1);
  });
});
