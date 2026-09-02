import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { projectBands } from '../lib/libraryHelpers';

// ===========================================================================
// ★★★ fix-483 §A (P-136) — THE LIBRARY READS LEFT TO RIGHT
// ===========================================================================
//
// Bobby, 2026-09-02, five rulings in one message:
//
//   1. *"add a graphic highlight every project or 3rd or 5th project so you can
//      follow things left to right."*
//   2. *"under library, remove the option for tag, and remove tags from the
//      list below. Under unit, get rid of work, and the filter below for work.
//      Also remove shape."*
//   3. *"there is a ton of open space to the right of Unit and to the right of
//      Site. I want to be able to click anywhere within that and it switches
//      the search parameter. The Unit pill will be the thing that highlights,
//      not the whole box."*
//   4. *"remove the search feature at the top of the library and the clear that
//      goes with it… currently there's three clear features. We don't want to
//      touch the two within site and unit, just the one that is fixed below
//      unit but above address."*
//   5. *"under unit, TYPE and UNIT TYPE 2x. seems redundant."*
//
// ★★ THIS FILE IS ALSO WHERE THE RETIREMENTS LAND, so nothing was dropped
// silently. Removed elsewhere and re-asserted here as ABSENCE:
//   · LibraryMatrix.test — 4 search/page-Clear tests, 2 more in fix-122's and
//     fix-469's blocks;
//   · libraryHelpers.test — the tag and the multi-token search filters;
//   · RegularShapeFix410 §3 (6) and §5 (3);
//   · UnitsRowFix412 §B4's three work-filter tests;
//   · StructAddressSearchFix380 §3 (2).

const T = 'test-tenant-uuid';

// ★ TWO projects with SEVERAL units each — the shape §A1 is about. Project `a`
//   has three units and `b` has two, so a band that followed POSITION rather
//   than PROJECT would visibly cut both.
const fixtures = vi.hoisted(() => ({
  projects: [
    {
      id: 'a',
      address: '100 Apple Way',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 3,
      num_lots: 1,
      is_corner_lot: true,
      is_regular_shape: true,
      zone: 'NR',
      lot_width: 40,
      lot_depth: 100,
      alley: 'Yes',
      product_types: ['SFR'],
      project_tags: ['ECA'],
      unit_types: [
        { label: 'Cottage 1', width_ft: 20, depth_ft: 60, qty: 1, stories: 2 },
        { label: 'Cottage 2', width_ft: 30, depth_ft: 60, qty: 1, stories: 2 },
        { label: 'Cottage 3', width_ft: 40, depth_ft: 60, qty: 1, stories: 2 },
      ],
      updated_at: '2026-06-25T10:00:00Z',
    },
    {
      id: 'b',
      address: '300 Oak Ln',
      juris: 'Bellevue',
      archived: false,
      notes: null,
      units: 2,
      num_lots: 5,
      is_corner_lot: false,
      is_regular_shape: false,
      zone: 'R-2',
      lot_width: 60,
      lot_depth: 120,
      alley: 'No',
      product_types: ['SFR', 'Duplex'],
      project_tags: ['SIP'],
      unit_types: [
        { label: 'SFR 1', width_ft: 25, depth_ft: 80, qty: 1, stories: 3 },
        { label: 'SFR 2', width_ft: 35, depth_ft: 80, qty: 1, stories: 3 },
      ],
      updated_at: '2026-06-25T10:00:00Z',
    },
  ],
  permits: [
    {
      id: 1,
      project_id: 'a',
      type: 'Building Permit',
      stage: 'de',
      stage_override: 'de',
      updated_at: '2026-05-10T00:00:00Z',
      permit_cycles: [],
    },
    {
      id: 2,
      project_id: 'b',
      type: 'Building Permit',
      stage: 'de',
      stage_override: 'de',
      updated_at: '2026-05-10T00:00:00Z',
      permit_cycles: [],
    },
  ],
}));

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: fixtures.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: fixtures.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
const appConfigMap = vi.hoisted(() => ({ current: new Map<string, unknown>() }));
vi.mock('../hooks/useAppConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAppConfig')>();
  return { ...actual, useAppConfig: () => ({ map: appConfigMap.current }) };
});

import LibraryMatrix from '../components/LibraryMatrix';

beforeEach(() => {
  window.sessionStorage.clear();
  appConfigMap.current = new Map<string, unknown>([
    ['productTypeOptions', ['SFR', 'Cottages', 'Duplex']],
  ]);
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LibraryMatrix />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const goUnit = () => fireEvent.click(screen.getByTestId('filter-chip-unit'));

/** Every unit row's `data-band`, in render order. */
function unitBands(): string[] {
  return Array.from(
    document.querySelectorAll('[data-testid^="library-unit-row-"]'),
  ).map((el) => (el as HTMLElement).dataset.band ?? '');
}

/** Which project each rendered unit row belongs to, in render order. */
function unitProjects(): string[] {
  return Array.from(
    document.querySelectorAll('[data-testid^="library-unit-row-"]'),
  ).map(
    (el) =>
      (el as HTMLElement).dataset.testid!.replace('library-unit-row-', '').split('-')[0]!,
  );
}

// ---------------------------------------------------------------------------
// §A1 — the shading
// ---------------------------------------------------------------------------
describe('fix-483 §A1: alternate PROJECTS are shaded, not alternate rows', () => {
  it('★★★ the band is a pure function of the project, in order of first appearance', () => {
    expect(projectBands(['a', 'a', 'b', 'b', 'c'])).toEqual([0, 0, 1, 1, 0]);
  });

  it('★★★ …so a SPLIT project keeps ONE band — the whole reason it is not index % 2', () => {
    // ★★★ THE CASE THE BRIEF ASKS ABOUT. A width sort interleaves units from
    //     different projects. `index % 2` would hand the two halves of `a`
    //     different colours and the stripe would stop meaning "this row belongs
    //     to that project" — which is the only thing it is for.
    expect(projectBands(['a', 'b', 'a', 'b', 'a'])).toEqual([0, 1, 0, 1, 0]);
    expect(projectBands(['a', 'b', 'a'])).toEqual([0, 1, 0]);
  });

  it('★★ every row of one project shares its band, under the DEFAULT sort', () => {
    renderIt();
    goUnit();
    const projects = unitProjects();
    const bands = unitBands();
    expect(projects.length).toBe(5); // 3 units of `a` + 2 of `b`
    const byProject = new Map<string, Set<string>>();
    projects.forEach((p, i) => {
      if (!byProject.has(p)) byProject.set(p, new Set());
      byProject.get(p)!.add(bands[i]!);
    });
    for (const [p, set] of byProject) {
      expect(set.size, `project ${p} has ${set.size} bands`).toBe(1);
    }
    // ★ …and the two projects differ, or the shade would say nothing.
    expect(byProject.get('a')).not.toEqual(byProject.get('b'));
  });

  it('★★★ …and under a sort that SPLITS a project across the table', () => {
    // ★ Sorting by unit WIDTH interleaves: a=20, b=25, a=30, b=35, a=40.
    renderIt();
    goUnit();
    fireEvent.click(screen.getByTestId('library-uth-width'));
    const projects = unitProjects();
    const bands = unitBands();
    // The sort really did interleave — otherwise this test proves nothing.
    expect(new Set(projects.slice(0, 3)).size).toBeGreaterThan(1);
    const byProject = new Map<string, Set<string>>();
    projects.forEach((p, i) => {
      if (!byProject.has(p)) byProject.set(p, new Set());
      byProject.get(p)!.add(bands[i]!);
    });
    for (const [p, set] of byProject) {
      expect(set.size, `project ${p} is split across ${set.size} bands`).toBe(1);
    }
  });

  it('★★ the SITE table gets the same rule, which there means alternate rows', () => {
    // One row per project, so "shade alternate projects" resolves to a stripe.
    // ONE rule, both tables — not two.
    renderIt();
    const bands = Array.from(
      document.querySelectorAll('[data-testid^="library-row-"]'),
    ).map((el) => (el as HTMLElement).dataset.band);
    expect(bands).toEqual(['off', 'on']);
  });

  it('★★ the shade is a CLASS, so the hover still wins on a banded row', () => {
    // ★★★ An inline background would beat `hover:bg-s2` and a banded row would
    //     silently lose its hover. `.hover\\:bg-s2:hover` carries a pseudo-class
    //     and outranks `.bg-bg`; that only holds while the band is a class.
    renderIt();
    const banded = Array.from(
      document.querySelectorAll('[data-testid^="library-row-"]'),
    ).find((el) => (el as HTMLElement).dataset.band === 'on') as HTMLElement;
    expect(banded.className).toContain('bg-bg');
    expect(banded.className).toContain('hover:bg-s2');
    expect(banded.style.background).toBe('');
  });
});

// ---------------------------------------------------------------------------
// §A2 / §A4 / §A5 — what is gone
// ---------------------------------------------------------------------------
describe('fix-483 §A2/§A4/§A5: the controls and columns Bobby named are gone', () => {
  it('★★★ the Tag filter and the Tags column are both gone', () => {
    renderIt();
    expect(screen.queryByTestId('filter-tag')).not.toBeInTheDocument();
    const headers = Array.from(
      screen.getByTestId('library-table').querySelectorAll('thead th'),
    ).map((th) => th.textContent?.trim());
    expect(headers.some((h) => h?.startsWith('Tags'))).toBe(false);
    // ★ …and the tag VALUES are nowhere in the table either — a header can be
    //   removed while the cell keeps rendering into the wrong column.
    expect(within(screen.getByTestId('library-table')).queryByText('ECA')).toBeNull();
  });

  it('★★★ the Work filter and the Work column are both gone', () => {
    renderIt();
    expect(screen.queryByTestId('filter-work-scope')).not.toBeInTheDocument();
    goUnit();
    expect(screen.queryByTestId('library-uth-work')).not.toBeInTheDocument();
  });

  it('★★★ the Shape FILTER is gone and the Shape COLUMN stays', () => {
    // ★★ The one asymmetry in this ticket, and it is Bobby's wording: Tag and
    //    Work each lost their column in the same sentence; Shape was named
    //    alone. A column he did not ask about is not removed on inference.
    renderIt();
    expect(screen.queryByTestId('filter-regular-shape')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-th-isRegularShape')).toBeInTheDocument();
    expect(screen.getByTestId('library-regular-shape-a').textContent).toBe('Regular');
    expect(screen.getByTestId('library-regular-shape-b').textContent).toBe('Irregular');
  });

  it('★★★ the search box and the PAGE-LEVEL Clear are gone; the two card Clears are not', () => {
    renderIt();
    expect(screen.queryByTestId('library-search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('filter-clear')).not.toBeInTheDocument();
    // ★ fix-469's Clears only render when their card has something to clear —
    //   so set one field on each and require exactly two.
    fireEvent.change(screen.getByTestId('lotw-target'), { target: { value: '40' } });
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '20' } });
    expect(screen.getByTestId('filter-clear-site')).toBeInTheDocument();
    expect(screen.getByTestId('filter-clear-unit')).toBeInTheDocument();
    expect(
      document.querySelectorAll('[data-testid^="filter-clear"]'),
    ).toHaveLength(2);
  });

  it('★★★ the UNIT table drops TYPE and keeps UNIT TYPE', () => {
    renderIt();
    goUnit();
    expect(screen.queryByTestId('library-uth-productTypes')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-uth-unitLabel')).toBeInTheDocument();
    // ★ The SITE table keeps its Type — over there it is the only answer to
    //   "what kind of building is this", because there is no unit row beside it.
    fireEvent.click(screen.getByTestId('filter-chip-site'));
    expect(screen.getByTestId('library-th-productTypes')).toBeInTheDocument();
  });

  it('★★ every colSpan still matches its rendered header count', () => {
    // ★★★ A STALE colSpan IS INVISIBLE UNTIL THE TABLE IS EMPTY (fix-447), and
    //     this ticket moved BOTH counts. Read from the DOM, not from a number.
    renderIt();
    const siteHeaders = screen
      .getByTestId('library-table')
      .querySelectorAll('thead th').length;
    fireEvent.change(screen.getByTestId('lotw-target'), { target: { value: '999' } });
    expect(
      screen.getByText(/No projects match/i).getAttribute('colspan'),
    ).toBe(String(siteHeaders));

    fireEvent.click(screen.getByTestId('filter-clear-site'));
    goUnit();
    const unitHeaders = screen
      .getByTestId('library-table-unit')
      .querySelectorAll('thead th').length;
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '999' } });
    expect(
      screen.getByText(/No units match/i).getAttribute('colspan'),
    ).toBe(String(unitHeaders));
  });
});

// ---------------------------------------------------------------------------
// §A3 — the whole card is the target
// ---------------------------------------------------------------------------
describe('fix-483 §A3: clicking the card switches the view; clicking a control does not', () => {
  it('★★★ a click on the card body flips the view', () => {
    renderIt();
    expect(screen.getByTestId('filter-chip-unit').dataset.active).toBe('false');
    fireEvent.click(screen.getByTestId('filter-card-unit'));
    expect(screen.getByTestId('filter-chip-unit').dataset.active).toBe('true');
    expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('filter-card-site'));
    expect(screen.getByTestId('filter-chip-site').dataset.active).toBe('true');
  });

  it('★★★ …and a click INTO A CONTROL does not', () => {
    // ★★★ THE HALF THAT WOULD ACTUALLY BREAK PEOPLE. Every select inside the
    //     UNIT card would otherwise flip the view out from under a reader who
    //     was setting a SITE filter, and vice versa.
    renderIt();
    for (const id of ['filter-zone', 'filter-juris', 'lotw-target', 'filter-corner']) {
      fireEvent.click(screen.getByTestId(id));
      expect(
        screen.getByTestId('filter-chip-site').dataset.active,
        `${id} must not flip the view`,
      ).toBe('true');
    }
    goUnit();
    for (const id of ['filter-parking-kind', 'filter-stalls', 'unitw-target']) {
      fireEvent.click(screen.getByTestId(id));
      expect(
        screen.getByTestId('filter-chip-unit').dataset.active,
        `${id} must not flip the view`,
      ).toBe('true');
    }
  });

  it('★★ a card Clear is a control too — it clears, it does not switch', () => {
    // ★ The Clear lives INSIDE the other card's heading row, so a naive
    //   whole-card handler would clear the UNIT card and move the reader to it.
    renderIt();
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '20' } });
    expect(screen.getByTestId('filter-chip-site').dataset.active).toBe('true');
    fireEvent.click(screen.getByTestId('filter-clear-unit'));
    expect((screen.getByTestId('unitw-target') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('filter-chip-site').dataset.active).toBe('true');
  });

  it('★★ the PILL is what highlights — the card carries no active styling', () => {
    // Bobby: *"The Unit pill will be the thing that highlights, not the whole
    // box."* The two cards must be indistinguishable from each other.
    renderIt();
    const site = screen.getByTestId('filter-card-site');
    const unit = screen.getByTestId('filter-card-unit');
    expect(site.className).toBe(unit.className);
    expect(site.style.borderColor).toBe(unit.style.borderColor);
    expect(site.style.background).toBe(unit.style.background);
    goUnit();
    expect(screen.getByTestId('filter-card-site').className).toBe(
      screen.getByTestId('filter-card-unit').className,
    );
  });
});
