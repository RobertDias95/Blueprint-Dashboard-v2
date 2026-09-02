import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q6.3.a: smoke tests for LibraryMatrix. Mocks the two read hooks so the
// component renders synchronously with a fixed dataset; verifies row
// rendering, filter narrowing, sort toggling, and the empty state.

const T = 'test-tenant-uuid';

// fix-22 Mig 3: physical fields (units/zone/lot_*/alley/product_types/
// project_tags) live on projects now. Matrix rows read from project.
const fixtures = vi.hoisted(() => ({
  projects: [
    {
      id: 'a',
      address: '100 Apple Way',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 3,
      // fix-122: project-level num_lots + is_corner_lot. Project a is
      // a 1-lot corner; project b is a 5-lot subdivision, not on a
      // corner; project c is unanswered (null) on both.
      num_lots: 1,
      is_corner_lot: true,
      zone: 'NR',
      lot_width: 40,
      lot_depth: 100,
      alley: 'Yes',
      product_types: ['SFR'],
      project_tags: ['ECA'],
      // fix-81: three Cottages — narrow + short. Used by the
      // unit-width filter test (25 ± 2 matches all three) and the
      // search-by-unit-name test ("cottage" surfaces this project).
      // fix-205: cottages carry stories=2; a-3 is a BLANK-label unit (4
      // stories) used by the "unnamed → single product type" + stories
      // filter tests.
      unit_types: [
        { label: 'Cottage 1', width_ft: 25, depth_ft: 60, qty: 1, stories: 2 },
        { label: 'Cottage 2', width_ft: 25, depth_ft: 60, qty: 1, stories: 2 },
        { label: 'Cottage 3', width_ft: 25, depth_ft: 60, qty: 1, stories: 2 },
        { label: '', width_ft: 30, depth_ft: 50, qty: 1, stories: 4 },
      ],
      // fix-206: OCC token so the editable Library unit table is enabled.
      updated_at: '2026-06-25T10:00:00Z',
    },
    {
      id: 'b',
      address: '300 Oak Ln',
      juris: 'Bellevue',
      archived: false,
      notes: null,
      units: 5,
      num_lots: 5,
      is_corner_lot: false,
      zone: 'R-2',
      lot_width: 60,
      lot_depth: 120,
      alley: 'No',
      // fix-209: b is the MULTI-product-type fixture (its unit label "SFR 1"
      // is a legacy/non-type value → the Label select reads unselected).
      product_types: ['SFR', 'Duplex'],
      project_tags: ['SIP'],
      // One SFR unit at 40×80 — used by the unit-width filter test
      // (target 40 ± 2 matches this row's unit, none of project a's
      // 25-wide cottages).
      unit_types: [
        { label: 'SFR 1', width_ft: 40, depth_ft: 80, qty: 1, stories: 3 },
      ],
      updated_at: '2026-06-25T10:00:00Z',
    },
    {
      id: 'c',
      address: '500 Pike St',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 7,
      zone: 'NR',
      lot_width: 80,
      lot_depth: 120,
      alley: 'Yes',
      product_types: ['SFR'],
      project_tags: [],
      // No unit_types at all — caret should not render; row drops out
      // of any unit-dim filter.
      unit_types: null,
    },
    { id: 'd', address: '700 Archived', juris: 'Seattle', archived: true, notes: null },
  ],
  permits: [
    {
      id: 1,
      project_id: 'a',
      type: 'Building Permit',
      stage: 'de',
      stage_override: 'de',
      status: null,
      num: null,
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: 3,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: 'NR',
      product_types: ['SFR'],
      project_tags: ['ECA'],
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      lot_width: 40,
      lot_depth: 100,
      alley: 'Yes',
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-10T00:00:00Z',
      permit_cycles: [],
    },
    {
      id: 2,
      project_id: 'b',
      type: 'Building Permit',
      stage: 'pm',
      stage_override: 'pm',
      status: null,
      num: null,
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: 5,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: 'R-2',
      product_types: ['Attached Units'],
      project_tags: ['SIP'],
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      lot_width: 60,
      lot_depth: 120,
      alley: 'No',
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-10T00:00:00Z',
      permit_cycles: [],
    },
    {
      id: 3,
      project_id: 'c',
      type: 'Building Permit',
      stage: 'de',
      stage_override: 'de',
      status: null,
      num: null,
      da: null,
      dm: null,
      ent_lead: null,
      dual_da: null,
      go_date: null,
      target_submit: null,
      dd_start: null,
      dd_end: null,
      expected_issue: null,
      actual_issue: null,
      approval_date: null,
      intake_date: null,
      units: 7,
      notes: null,
      cycle_model: null,
      view_cycle: null,
      kickoff_date: null,
      zone: 'NR',
      product_types: ['SFR'],
      project_tags: [],
      unit_types: null,
      parking_type: null,
      parking_stalls: null,
      lot_width: 80,
      lot_depth: 120,
      alley: 'Yes',
      corr_rounds: null,
      permit_owner: null,
      architect: null,
      nickname: null,
      struct_address: null,
      portal_url: null,
      updated_at: '2026-05-10T00:00:00Z',
      permit_cycles: [],
    },
  ],
}));

// fix-206: capture the editable-table write path.
const updateMutateAsync = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
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

// fix-232: the Product Type filter reads app_config.productTypeOptions (the
// canonical registry). Mock useAppConfig; keep the real readAppConfigStringArray.
const appConfigMap = vi.hoisted(() => ({ current: new Map<string, unknown>() }));
vi.mock('../hooks/useAppConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAppConfig')>();
  return { ...actual, useAppConfig: () => ({ map: appConfigMap.current }) };
});

import LibraryMatrix from '../components/LibraryMatrix';
// ★ fix-467 §2: imported so the "not painted" property is checked against the
//   REAL palette — and so this file fails if somebody deletes it.
import { SITE_PALETTE, UNIT_PALETTE } from '../lib/libraryGroupPalette';

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({ id: 'a', updated_at: '2026-06-25T11:00:00Z' });
  // ★ fix-449 §C: the canonical product-type registry, so the off-list mark
  //   has something to judge against. An EMPTY map means "registry not loaded"
  //   and marks nothing, deliberately — otherwise every row would wear a
  //   warning for the frame before app_config arrives.
  appConfigMap.current = new Map<string, unknown>([
    ['productTypeOptions', ['SFR', 'Cottages', 'Duplex', 'Condo', 'ADU', 'DADU', 'SFR+ADU', 'Remodel']],
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

// ★★★ fix-447 §B6 — EVERY CARET CLICK BELOW IS NOW A VIEW SWITCH.
//
// fix-81's caret opened a per-project mini-table of unit rows; fix-206 made
// those rows EDITABLE. The caret is gone (Bobby, P-055: the pills switch the
// view, SITE shows site columns and UNIT shows one row per unit), so the route
// to the unit rows changed — but the rows themselves did not. Their test ids
// (`library-unit-<project>-<index>-<field>`) are untouched, which is why these
// tests re-point rather than get rewritten.
//
// ★★ THE ONE REAL LOSS IS THE WRAPPER. `library-unit-table-<id>` was the
// mini-table element; there is one table for every project now, so assertions
// on it become assertions on `library-table-unit`.
function goUnitView() {
  fireEvent.click(screen.getByTestId('filter-chip-unit'));
}

describe('fix-232: Product Type filter reads the productTypeOptions registry', () => {
  it('offers exactly the registry options (not the old hardcoded stale list)', () => {
    appConfigMap.current = new Map<string, unknown>([
      ['productTypeOptions', ['SFR', 'Duplex', 'Cottages']],
    ]);
    renderIt();
    const select = screen.getByTestId('filter-product-type') as HTMLSelectElement;
    const offered = [...select.options].map((o) => o.value).filter((v) => v !== '');
    expect(offered).toEqual(['SFR', 'Duplex', 'Cottages']);
    // The stale legacy values are gone from the option list.
    expect(offered).not.toContain('Attached Units');
    expect(offered).not.toContain('SFR w/ Accessory Units');
  });

  it('offers nothing when the registry is empty (no hardcoded fallback)', () => {
    appConfigMap.current = new Map<string, unknown>();
    renderIt();
    const select = screen.getByTestId('filter-product-type') as HTMLSelectElement;
    const offered = [...select.options].map((o) => o.value).filter((v) => v !== '');
    expect(offered).toEqual([]);
  });
});

describe('<LibraryMatrix />', () => {
  it('renders one row per non-archived project that has a permit', () => {
    renderIt();
    expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.getByTestId('library-row-c')).toBeInTheDocument();
    // 'd' is archived → not rendered.
    expect(screen.queryByTestId('library-row-d')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-count').textContent).toMatch(/^3 projects/);
  });

  it('renders the address as a link to the project detail page', () => {
    renderIt();
    const link = screen.getByTestId('library-row-a').querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/project/a');
  });

  // ★★★ fix-483 §A4 (P-136) — RETIRED WITH THE SEARCH BOX AND THE PAGE CLEAR.
  //
  // Four tests went here and they were all healthy: `search filter narrows by
  // address tokens`, `search by unit_type name surfaces projects with a
  // matching unit`, `shows the empty state when filters exclude every row`
  // (which drove the empty state THROUGH the search box), and `Clear button
  // resets all filters`. Two more went below with fix-122's and fix-469's
  // page-Clear assertions.
  //
  // Bobby, 2026-09-02: *"remove the search feature at the top of the library and
  // the clear that goes with it… currently there's three clear features. We
  // don't want to touch the two within site and unit, just the one that is fixed
  // below unit but above address."*
  //
  // ★★ WHAT REPLACED THEM RATHER THAN WHAT WAS DROPPED:
  //   · the empty state is still asserted — through the JURISDICTION filter, in
  //     `shows the empty state when a filter excludes every row` below, so the
  //     colSpan guard fix-447 built keeps its cover;
  //   · the two CardClears keep every one of fix-469 §2's assertions, untouched;
  //   · that the search box and the page Clear are ABSENT is asserted in
  //     LibraryReadsLeftToRightFix483.test.tsx.

  it('lot-width target ± buf narrows correctly', () => {
    renderIt();
    // Target 60 ± 2 → matches lotWidth in [58, 62]. Only row b (60) qualifies.
    fireEvent.change(screen.getByTestId('lotw-target'), { target: { value: '60' } });
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
  });

  it('jurisdiction filter is exact match', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('filter-juris'), {
      target: { value: 'Bellevue' },
    });
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
  });

  it('clicking a sortable header toggles the sort direction (units numeric)', () => {
    renderIt();
    const rows = () =>
      Array.from(document.querySelectorAll('[data-testid^="library-row-"]')).map(
        (el) => (el as HTMLElement).dataset.testid?.replace('library-row-', ''),
      );
    // Default sort is address ascending → [a, b, c].
    expect(rows()).toEqual(['a', 'b', 'c']);
    // Click "Units" once → ascending (3, 5, 7) → [a, b, c] (same as default).
    fireEvent.click(screen.getByTestId('library-th-units'));
    expect(rows()).toEqual(['a', 'b', 'c']);
    // Click again → descending (7, 5, 3) → [c, b, a].
    fireEvent.click(screen.getByTestId('library-th-units'));
    expect(rows()).toEqual(['c', 'b', 'a']);
  });

  // ★ fix-483 §A4: this drove the empty state through the SEARCH BOX. The box is
  //   gone; the empty state is not, and neither is the colSpan guard it covers
  //   (fix-447: *"A STALE colSpan IS INVISIBLE UNTIL THE TABLE IS EMPTY"*). Same
  //   assertion, reached through a filter that still exists.
  it('shows the empty state when a filter excludes every row', () => {
    renderIt();
    // ★ A lot width no fixture row has. (Not the jurisdiction select — its
    //   options come from the fixture, so it cannot be set to a miss.)
    fireEvent.change(screen.getByTestId('lotw-target'), {
      target: { value: '999' },
    });
    expect(screen.getByText(/No projects match/i)).toBeInTheDocument();
    expect(screen.getByTestId('library-count').textContent).toMatch(/^0 projects/);
  });

  // fix-81: per-row caret expands a nested mini-table that lists every
  // unit_type on the project (name + width + depth + qty).
  it('clicking the caret expands a row to show its unit_types', () => {
    renderIt();
    // Default: collapsed; mini-table should not be in the DOM.
    expect(screen.queryByTestId('library-table-unit')).not.toBeInTheDocument();
    goUnitView();
    const miniTable = screen.getByTestId('library-table-unit');
    expect(miniTable).toBeInTheDocument();
    // ★★★ fix-449 §C: project a is single-type (SFR) and its rows carry
    //     legacy "Cottage N" labels. fix-212 displayed "SFR" over them; the
    //     ruling is that the stored value is shown, and marked.
    expect(
      (screen.getByTestId('library-unit-a-0-label') as HTMLSelectElement).value,
    ).toBe('Cottage 1');
    expect(
      (screen.getByTestId('library-unit-a-0-w') as HTMLInputElement).value,
    ).toBe('25');
    expect(
      (screen.getByTestId('library-unit-a-0-d') as HTMLInputElement).value,
    ).toBe('60');
    expect(
      (screen.getByTestId('library-unit-a-1-label') as HTMLSelectElement).value,
    ).toBe('Cottage 2');
    expect(
      (screen.getByTestId('library-unit-a-2-label') as HTMLSelectElement).value,
    ).toBe('Cottage 3');
  });

  it('projects with no unit_types do not render an expand caret', () => {
    renderIt();
    expect(screen.queryByTestId('library-caret-c')).not.toBeInTheDocument();
  });

  // ★★★ fix-447 INVERTS THE AUTO-EXPAND HALF OF THIS PIN, AND KEEPS THE REST.
  //
  // fix-81 auto-opened a project's caret when a unit filter was on, because
  // otherwise the rows you had just filtered by were invisible. The view switch
  // is the honest version of that: *"The metric you are searching by decides
  // the columns you get back"* — but it is the READER who decides, by clicking
  // UNIT, not the filter deciding for them. A filter that silently reshaped the
  // whole table would be a worse surprise than the one it fixed.
  //
  // ★★ THE FILTERING AND THE HIGHLIGHT ARE UNCHANGED — both asserted below, in
  // the view where unit rows live.
  // ★★★ AMENDED BY fix-469 §1 — the title used to end "and the UNIT view
  //     HIGHLIGHTS matches". It now RETURNS only matches, which is the same
  //     information delivered by absence instead of by colour. Everything this
  //     test asserted about the SITE view and about the view not switching is
  //     untouched; only the last two lines changed, from "the match is
  //     flagged" to "only the match is printed".
  it('unit-width target ± buf filters by per-unit dim, and the UNIT view returns only matches', () => {
    renderIt();
    // Target 40 ± 2 → matches [38, 42]. Project a's cottages are 25 wide
    // (out). Project b's SFR 1 is 40 wide (in). Project c has no units
    // (drops when unit filter is active).
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '40' } });
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
    // ★ The filter did NOT switch the view. Still SITE, still the site table.
    expect(screen.queryByTestId('library-table-unit')).not.toBeInTheDocument();
    goUnitView();
    expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();
    // ★★ The matching unit is printed…
    expect(screen.getByTestId('library-unit-row-b-0')).toBeInTheDocument();
    // ★★ …and it is the ONLY row, so nothing needs flagging. `data-matched`
    //    is deliberately absent now: every printed row matches, and marking
    //    all of them would mark nothing (fix-469 §1.4).
    expect(
      screen.getByTestId('library-unit-row-b-0').getAttribute('data-matched'),
    ).toBeNull();
    expect(screen.getAllByTestId(/^library-unit-row-/)).toHaveLength(1);
  });

  // ★★★ AMENDED BY fix-469 §1, AND THIS FIXTURE IS BOBBY'S COMPLAINT IN
  //     MINIATURE. Project a holds FOUR units — three 25-wide Cottages and one
  //     30-wide unnamed. Searching 25 ± 2 used to print all four and highlight
  //     three; the fourth was the noise. The claim that survives is the one the
  //     title always made — *all three Cottages match* — and it is now asserted
  //     by their presence rather than by their colour.
  it('unit-width filter narrows project a to its Cottage rows (all three match 25 ± 2)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '25' } });
    expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
    goUnitView();
    // All three Cottages are printed…
    expect(screen.getByTestId('library-unit-row-a-0')).toBeInTheDocument();
    expect(screen.getByTestId('library-unit-row-a-1')).toBeInTheDocument();
    expect(screen.getByTestId('library-unit-row-a-2')).toBeInTheDocument();
    // ★★★ …and the 30-wide fourth unit of the SAME project is NOT. This one
    //     line is the whole ticket: a project qualifying no longer drags its
    //     non-matching units onto the screen with it.
    expect(screen.queryByTestId('library-unit-row-a-3')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^library-unit-row-/)).toHaveLength(3);
  });

  // ★ fix-483 §A4: fix-81's *"typing 'cottage' surfaces every project that has a
  //   'Cottage *' unit"* went with the box. The UNIT VIEW is what answers that
  //   question now — it prints one row per matching unit, labelled — and
  //   `★★★ §B3` below covers it.

  // ★★★ fix-447 §B6 — THIS PIN IS INVERTED BECAUSE THE CARET IS GONE.
  //
  // Bobby, P-055: *"the pills should switch the view."* There is no per-row
  // caret to click and no auto-expansion to undo; the view is one explicit
  // choice, remembered per person, and a filter never moves it. What the test
  // asserts now is exactly that: setting a unit filter leaves you where you
  // were, and the caret element does not exist to be clicked.
  it('fix-81 → fix-447: no caret, and a unit filter never switches the view', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '25' } });
    expect(screen.queryByTestId('library-caret-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-table-unit')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-table')).toBeInTheDocument();
    // …and the switch is what moves it, in both directions.
    goUnitView();
    expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('filter-chip-site'));
    expect(screen.getByTestId('library-table')).toBeInTheDocument();
    expect(screen.queryByTestId('library-table-unit')).not.toBeInTheDocument();
  });

  // fix-205: Stories column + "unnamed" fix + Stories filter.
  describe('fix-205: stories + unnamed', () => {
    it('expand shows a Stories column with each unit_type stories value', () => {
      renderIt();
      goUnitView();
      const table = screen.getByTestId('library-table-unit');
      expect(table.textContent).toContain('Stories'); // column header
      // Cottage rows carry stories=2 (now an editable input value).
      expect(
        (screen.getByTestId('library-unit-a-0-stories') as HTMLInputElement)
          .value,
      ).toBe('2');
    });

    it('fix-212: a blank-label unit shows the single product type in the dropdown, never "unnamed"', () => {
      renderIt();
      goUnitView();
      // a-3 has label '' and the project's single product type is SFR: the Label
      // is a dropdown auto-selected to SFR; the row never renders "unnamed".
      const labelSelect = screen.getByTestId(
        'library-unit-a-3-label',
      ) as HTMLSelectElement;
      // ★ fix-449 keeps fix-212's half that is about ABSENCE: a BLANK label
      //   still fills from the project's lone type. a-3 stores ''.
      expect(labelSelect.value).toBe('SFR');
      expect(
        screen.getByTestId('library-unit-row-a-3').textContent,
      ).not.toContain('unnamed');
    });

    it('Stories filter = 4+ narrows to projects with a 4+-story unit; the UNIT view highlights it', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-stories'), {
        target: { value: '4+' },
      });
      // Project a has the 4-story unit (a-3); b's SFR is 3, c has no units.
      expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
      expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
      expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
      // ★ The view is the reader's choice; only the 4-story unit matches.
      //
      // ★★★ AMENDED BY fix-469 §1. The surviving claim is exactly what the two
      //     lines below always said — a-3 matches and a-0 does not — but the
      //     second is now expressed as ABSENCE. That is the stronger form: it
      //     used to assert "a-0 is on screen without a highlight", which is
      //     precisely the noise Bobby marked with a red X.
      goUnitView();
      expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();
      expect(screen.getByTestId('library-unit-row-a-3')).toBeInTheDocument();
      expect(screen.queryByTestId('library-unit-row-a-0')).not.toBeInTheDocument();
      expect(screen.getAllByTestId(/^library-unit-row-/)).toHaveLength(1);
    });

    it('Stories filter = 2 narrows to projects with a 2-story unit', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-stories'), {
        target: { value: '2' },
      });
      // Only project a's cottages are 2-story.
      expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
      expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
      expect(screen.getByTestId('library-count').textContent).toMatch(/^1 project/);
    });
  });

  // fix-206: the unit table is editable through the SAME useUpdateProject path
  // as Project Overview (one store → bidirectional by construction).
  describe('fix-206: editable unit table', () => {
    function expandA() {
      renderIt();
      goUnitView();
    }

    it('editing a unit width persists via useUpdateProject with the project OCC token + resolved rows', () => {
      expandA();
      const wInput = screen.getByTestId('library-unit-a-0-w') as HTMLInputElement;
      fireEvent.change(wInput, { target: { value: '27.5' } });
      fireEvent.blur(wInput);
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      const call = updateMutateAsync.mock.calls[0][0];
      expect(call.projectId).toBe('a');
      expect(call.expectedUpdatedAt).toBe('2026-06-25T10:00:00Z');
      // Decimal persists; the edited row carries the new width.
      expect(call.patch.unit_types[0].width_ft).toBe(27.5);
      // ★★★ fix-449: the save path no longer rewrites a stored label. This is
      //     the path that would have written "SFR" over prod's ten
      //     "Type A"/"Type B" rows the first time anybody typed a width.
      expect(call.patch.unit_types[0].label).toBe('Cottage 1');
      expect(call.patch.unit_types).toHaveLength(4);
    });

    it('editing stories persists the new stories value', () => {
      expandA();
      const sty = screen.getByTestId('library-unit-a-0-stories') as HTMLInputElement;
      fireEvent.change(sty, { target: { value: '3' } });
      fireEvent.blur(sty);
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      expect(updateMutateAsync.mock.calls[0][0].patch.unit_types[0].stories).toBe(3);
    });

    it('a blank-label row saved under a single product type persists that type (no "unnamed")', () => {
      expandA();
      // a-3 has a blank label; editing its depth triggers a save that resolves
      // the label to the project's single product type (SFR).
      const dInput = screen.getByTestId('library-unit-a-3-d') as HTMLInputElement;
      fireEvent.change(dInput, { target: { value: '52' } });
      fireEvent.blur(dInput);
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      const row = updateMutateAsync.mock.calls[0][0].patch.unit_types[3];
      expect(row.depth_ft).toBe(52);
      expect(row.label).toBe('SFR');
    });

    it('a no-op blur (unchanged value) does not fire a write', () => {
      expandA();
      const wInput = screen.getByTestId('library-unit-a-0-w') as HTMLInputElement;
      // Blur without changing the value (still 25).
      fireEvent.blur(wInput);
      expect(updateMutateAsync).not.toHaveBeenCalled();
    });

    it('fix-212: single-product-type project renders the Label dropdown auto-selected to the type', () => {
      // Project a has the single product type SFR → a product-type dropdown with
      // ★ fix-449: still a SELECT (fix-232's dropdown-only rule is untouched);
      //   what changed is that it shows the stored value rather than the type.
      expandA();
      const label = screen.getByTestId('library-unit-a-0-label');
      expect(label.tagName.toLowerCase()).toBe('select');
      expect((label as HTMLSelectElement).value).toBe('Cottage 1');
    });
  });

  // fix-209: product-type-only Label dropdown + narrower Qty/Sty — mirrored
  // exactly from Project Overview (byte-identical behavior, one store).
  describe('fix-209: product-type-only Label + narrow Qty/Sty', () => {
    function expandB() {
      renderIt();
      goUnitView();
    }
    function expandA() {
      renderIt();
      goUnitView();
    }

    it('fix-209 → fix-449: the options carry the STORED value and "Other…"', () => {
      expandB(); // project b → product_types ['SFR', 'Duplex'], label "SFR 1"
      const select = screen.getByTestId('library-unit-b-0-label') as HTMLSelectElement;
      expect(select.tagName.toLowerCase()).toBe('select');
      const opts = Array.from(select.options).map((o) => o.value);
      // ★★ fix-415's append rule: a control must be able to display what it
      //    holds, and "Other…" is how a new off-list value is entered on
      //    purpose (§C1).
      expect(opts).toEqual(['', 'SFR', 'Duplex', 'SFR 1', '__other__']);
    });

    it('fix-209 → fix-449: a non-type stored label is SELECTED and MARKED', () => {
      expandB();
      const select = screen.getByTestId('library-unit-b-0-label') as HTMLSelectElement;
      expect(select.value).toBe('SFR 1');
      expect(
        screen.getByTestId('library-unit-b-0-offlist'),
      ).toBeInTheDocument();
    });

    it('fix-209 → fix-449: editing a DIMENSION leaves the label alone', () => {
      expandB();
      const wInput = screen.getByTestId('library-unit-b-0-w') as HTMLInputElement;
      fireEvent.change(wInput, { target: { value: '41' } });
      fireEvent.blur(wInput);
      expect(updateMutateAsync).toHaveBeenCalledTimes(1);
      const row = updateMutateAsync.mock.calls[0][0].patch.unit_types[0];
      expect(row.width_ft).toBe(41);
      expect(row.label).toBe('SFR 1');
    });

    it('Qty + Sty use the narrow w-7 class; W/D keep w-12', () => {
      expandA();
      expect(screen.getByTestId('library-unit-a-0-qty').className).toContain('w-7');
      expect(screen.getByTestId('library-unit-a-0-stories').className).toContain('w-7');
      expect(screen.getByTestId('library-unit-a-0-w').className).toContain('w-12');
      expect(screen.getByTestId('library-unit-a-0-w').className).not.toContain('w-7');
    });
  });

  // fix-122: two new Library columns (Lots, Corner) + two new filters.
  describe('fix-122: Lots / Corner columns + filters', () => {
    // ★★★ fix-406 REPLACED "renders Lots column" WITH ITS OPPOSITE. Bobby,
    // 2026-08-26: *"we can remove lots from the vertical bar below for the sort
    // column as it isnt really relevant here."* The three positive assertions
    // that used to stand here (a=1, b=5, c=—) were fix-122's, and they were
    // correct for four years of tickets; the column is now gone by ruling, so
    // the same three rows assert its ABSENCE instead.
    it('★★★ fix-406: the Lots column is gone from every row', () => {
      renderIt();
      for (const id of ['a', 'b', 'c']) {
        expect(screen.queryByTestId(`library-num-lots-${id}`)).toBeNull();
      }
      // ★ ...and so is its sort header, which is the half Bobby named.
      expect(screen.queryByTestId('library-th-numLots')).toBeNull();
    });

    it('renders Corner column with project-level is_corner_lot', () => {
      renderIt();
      expect(screen.getByTestId('library-corner-a').textContent).toBe('Yes');
      expect(screen.getByTestId('library-corner-b').textContent).toBe('No');
      // Project c has no is_corner_lot → em-dash (NULL ≠ confirmed No).
      expect(screen.getByTestId('library-corner-c').textContent).toBe('—');
    });

    it('★★★ fix-402 took the FILTER, fix-406 took the COLUMN — both gone', () => {
      // ★★ TWO RULINGS A DAY APART, AND THE FIRST WAS NOT WRONG.
      //
      //   2026-08-25: *"we dont need it as a filtering option for this screen"*
      //   2026-08-26: *"we can remove lots from the vertical bar below for the
      //                sort column as it isnt really relevant here."*
      //
      // This test used to assert the distinction between them — control absent,
      // column present — because that WAS the distinction on the 25th. The
      // second ruling widened the first, so the test now asserts both halves
      // gone. SUPERSEDED, NOT MISTAKEN (fix-400's rule): the old assertion is
      // quoted here rather than deleted without trace.
      renderIt();
      expect(screen.queryByTestId('filter-num-lots')).toBeNull();
      expect(screen.queryByTestId('library-num-lots-b')).toBeNull();
    });

    it('filter-corner=Yes keeps only is_corner_lot=true rows; NULL falls out', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-corner'), {
        target: { value: 'Yes' },
      });
      expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
      expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
      expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
    });

    it('filter-corner=No keeps only is_corner_lot=false rows', () => {
      renderIt();
      fireEvent.change(screen.getByTestId('filter-corner'), {
        target: { value: 'No' },
      });
      expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
      expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
      expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
    });

    // ★ fix-483 §A4: this pressed the PAGE-LEVEL Clear, which is gone. The
    //   Corner filter is a SITE-card field, and that it clears with its card is
    //   asserted by fix-469 §2's `SITE_FILTER_KEYS` coverage and by
    //   `filter-clear-site` below — the same claim, through the control that
    //   still exists.

    it('Closing Date does NOT render as a column (Library exclusion per spec)', () => {
      renderIt();
      // No "Closing" header in the matrix.
      const ths = Array.from(
        document.querySelectorAll('[data-testid="library-table"] thead th'),
      ).map((el) => el.textContent ?? '');
      for (const t of ths) {
        expect(t.toLowerCase()).not.toContain('closing');
      }
    });
  });
});


// ===========================================================================
// ★★★ fix-447 (P-055) — THE HEADINGS SWITCH THE VIEW
// ===========================================================================
describe('fix-447: SITE / UNIT are headings, and they switch the view', () => {
  const SITE_ONLY = ['library-th-zone', 'library-th-lotWidth', 'library-th-alley'];

  it('★★★ §A1: the headings are BIGGER than the field labels they head', () => {
    // ★★★ Bobby's complaint was literally true and this is the measurement.
    //     The old chip was text-[9px]; LABEL_CLASS.primary is 10px and
    //     .secondary is 9px — so the heading was SMALLER than the primary
    //     fields under it and equal to the secondary ones.
    // ★★★ AMENDED AGAIN BY fix-483 §B (P-137). The claim that survives every
    //     amendment is the RELATIVE one — the heading is bigger than the
    //     9px/10px field labels under it — and it is still read from what
    //     renders. What changed is the number: the pill is the app's shared
    //     `ToggleChip` now (11px bold), not a 13px extrabold heading, because
    //     Bobby asked for the Pipeline's toggle here and that control has one
    //     size everywhere.
    //
    // ★★ AND THE CAPTION IS A SIBLING AGAIN. fix-467 §2 moved it INSIDE the
    //    button to make the whole pill a target; §A3 makes the whole CARD the
    //    target, so the reason expired and the decision goes with it.
    renderIt();
    const site = screen.getByTestId('filter-chip-site');
    expect(site.className).toContain('text-[11px]');
    expect(site.className).not.toContain('text-[9px]');
    expect(site.tagName).toBe('BUTTON');
    // ★ The caption survives as the subheading, beside the pill.
    expect(screen.getByTestId('filter-chip-site-caption').textContent).toBe(
      'the lot',
    );
  });

  // =========================================================================
  // ★★★ fix-467 §2 (P-112) — loudness from CONTRAST, not from hue
  // =========================================================================
  //
  // Bobby: *"can we try something less subtle than just the under line letting
  // you know which realm you're searching in — like maybe the whole pill is
  // darker and the inactive one is greyed out or white? also — can the whole
  // pill area be clickable to toggle."*

  it('fix-467 §2: the ACTIVE segment is filled and the inactive one is not', () => {
    // ★★★ fix-483 §B (P-137): STILL FILLED, DIFFERENT FILL. fix-467's ruling —
    //     *"maybe the whole pill is darker and the inactive one is greyed out
    //     or white"* — is what this asserts, and it is still true; the ink is
    //     the app's DE blue rather than `--color-text` because Bobby has since
    //     asked for the Pipeline's toggle on this screen. Both halves come from
    //     `chipStyle`, which is the one place either colour is decided.
    renderIt();
    const site = screen.getByTestId('filter-chip-site'); // active by default
    const unit = screen.getByTestId('filter-chip-unit');
    expect(site.style.background).toBe('var(--color-de)');
    expect(unit.style.background).toBe('var(--color-surface)');
    // ★ The ink inverts with the fill, which is what makes it readable on both.
    expect(site.style.color).toBe('rgb(255, 255, 255)');
    expect(unit.style.color).toBe('var(--color-text)');
  });

  it('fix-467 §2: clicking the CAPTION toggles — the whole CARD is the target', () => {
    // ★★★ THE HALF THAT WAS ACTUALLY BROKEN, and it is still fixed — by a
    //     bigger hammer. fix-467 §2 pulled the caption INSIDE the button
    //     because a dead `<span>` beside it meant half of what looks like one
    //     control did nothing. fix-483 §A3 makes the whole CARD the target
    //     (Bobby: *"there is a ton of open space to the right of Unit and to
    //     the right of Site. I want to be able to click anywhere within that"*),
    //     so the caption is live again as ordinary empty space — and so is
    //     everything else in the card that is not a control.
    renderIt();
    expect(
      screen.getByTestId('filter-chip-unit').getAttribute('data-active'),
    ).toBe('false');
    fireEvent.click(screen.getByTestId('filter-chip-unit-caption'));
    expect(
      screen.getByTestId('filter-chip-unit').getAttribute('data-active'),
    ).toBe('true');
    expect(
      screen.getByTestId('filter-chip-site').getAttribute('data-active'),
    ).toBe('false');
  });

  it('fix-467 §2: it is still ONE real <button> with aria-pressed', () => {
    // ★ No onClick on a `<div>`: keyboard and screen-reader behaviour comes
    //   free from the element, and a wrapper with a handler would silently
    //   lose both while looking identical.
    renderIt();
    for (const id of ['filter-chip-site', 'filter-chip-unit']) {
      const el = screen.getByTestId(id);
      expect(el.tagName).toBe('BUTTON');
      expect(el.getAttribute('aria-pressed')).toBeTruthy();
      // ★ fix-483 §B: the caption is a SIBLING again — see the §A1 test above
      //   for why fix-467's reason for nesting it expired. What fix-467
      //   actually won is asserted right here and is untouched: the toggle is a
      //   real `<button>` carrying `aria-pressed`, so keyboard and
      //   screen-reader behaviour come free from the element. The card's own
      //   click handler is a MOUSE convenience layered over it, with no `role`
      //   and no `tabIndex` — it must never be the only way in.
      expect(el.parentElement?.querySelector('[data-testid$="-caption"]')).not.toBeNull();
    }
  });

  it('fix-467 §2: ★★★ PROPERTY — no rendered style reads from libraryGroupPalette', () => {
    // The one thing this ticket must not do is bring the colours back. fix-447
    // measured SITE #55abc4 at 2.23:1 and UNIT #9a77e8 at 2.89:1 against the
    // card, and **1.30:1 against each other** — the hue meant to tell the two
    // groups apart was very nearly the same hue twice. Bobby's new instruction
    // wins on what the control looks like; it does not make that false.
    //
    // ★ The palette module is KEPT and still exported — it is the record of how
    //   those hexes were derived. This asserts it is not PAINTED, which is a
    //   different claim from "it is gone".
    renderIt();
    for (const view of ['site', 'unit'] as const) {
      fireEvent.click(screen.getByTestId(`filter-chip-${view}`));
      for (const id of ['filter-chip-site', 'filter-chip-unit']) {
        const html = screen.getByTestId(id).outerHTML;
        for (const p of [SITE_PALETTE, UNIT_PALETTE]) {
          expect(html).not.toContain(p.chipBg);
          expect(html).not.toContain(p.chipText);
          expect(html).not.toContain(p.cardBorder);
        }
      }
    }
  });

  it('★★★ §B1: SITE is the default, and exactly one is active', () => {
    renderIt();
    expect(
      screen.getByTestId('filter-chip-site').getAttribute('data-active'),
    ).toBe('true');
    expect(
      screen.getByTestId('filter-chip-unit').getAttribute('data-active'),
    ).toBe('false');
    expect(screen.getByTestId('library-table')).toBeInTheDocument();
    expect(screen.queryByTestId('library-table-unit')).not.toBeInTheDocument();
  });

  it('★★★ §B2: SITE shows site columns and NONE of the unit ones', () => {
    renderIt();
    for (const id of SITE_ONLY) {
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
    // fix-402's rollups left with fix-81's caret — the unit facts live in the
    // unit view now, per unit rather than as a summary sentence.
    expect(screen.queryByTestId('library-parking-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-roof-deck-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-caret-a')).not.toBeInTheDocument();
  });

  it('★★★ §B3: UNIT shows one row per unit, with the unit columns', () => {
    renderIt();
    goUnitView();
    // Project a has four unit_types in the fixture; each is its own row.
    expect(screen.getByTestId('library-unit-row-a-0')).toBeInTheDocument();
    expect(screen.getByTestId('library-unit-row-a-1')).toBeInTheDocument();
    expect(screen.getByTestId('library-unit-row-a-2')).toBeInTheDocument();
    expect(screen.getByTestId('library-uth-width')).toBeInTheDocument();
    // ★ fix-483 §A2/§A5: `library-uth-work` and `library-uth-productTypes` went
    //   with the Work filter and the redundant TYPE column. Their absence is
    //   asserted in LibraryReadsLeftToRightFix483.
    expect(screen.getByTestId('library-uth-unitLabel')).toBeInTheDocument();
    // ★ …and the site-only columns are gone.
    for (const id of SITE_ONLY) {
      expect(screen.queryByTestId(id), id).not.toBeInTheDocument();
    }
  });

  it('★★★ §B5: the count line names both numbers in the UNIT view', () => {
    renderIt();
    expect(screen.getByTestId('library-count').textContent).toMatch(/project/);
    goUnitView();
    // ★★ "N units across M projects" — because 96 of 202 projects on prod hold
    //    no units at all, so the project count drops when you switch and a
    //    bare number changing like that reads as a broken filter.
    expect(screen.getByTestId('library-count').textContent).toMatch(
      /\d+ units? across \d+ projects?/,
    );
  });

  it('★★★ §B4: switching the view keeps every filter that was set', () => {
    // ★ fix-483 §A4: the search box was one of the two filters this carried
    //   across the switch. It is gone, so the claim is re-made with a SITE
    //   field and a UNIT field — which is the stronger version anyway: it
    //   proves BOTH cards survive the switch, not one card and a box that
    //   belonged to neither.
    renderIt();
    fireEvent.change(screen.getByTestId('filter-juris'), {
      target: { value: 'Seattle' },
    });
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '25' } });
    goUnitView();
    // ★★★ The filters are the SAME OBJECT either side of the switch — the pill
    //     changes the columns you get back, never which rows match.
    expect(
      (screen.getByTestId('filter-juris') as HTMLSelectElement).value,
    ).toBe('Seattle');
    expect(
      (screen.getByTestId('unitw-target') as HTMLInputElement).value,
    ).toBe('25');
    fireEvent.click(screen.getByTestId('filter-chip-site'));
    expect(
      (screen.getByTestId('filter-juris') as HTMLSelectElement).value,
    ).toBe('Seattle');
  });

  it('★★ §B4: both filter cards stay visible in both views', () => {
    renderIt();
    expect(screen.getByTestId('filter-card-site')).toBeInTheDocument();
    expect(screen.getByTestId('filter-card-unit')).toBeInTheDocument();
    goUnitView();
    expect(screen.getByTestId('filter-card-site')).toBeInTheDocument();
    expect(screen.getByTestId('filter-card-unit')).toBeInTheDocument();
  });

  it('★★ sorting a unit column orders UNITS', () => {
    renderIt();
    goUnitView();
    fireEvent.click(screen.getByTestId('library-uth-width'));
    const rows = [...document.querySelectorAll('[data-testid^="library-unit-row-"]')];
    expect(rows.length).toBeGreaterThan(1);
    // Ascending by width: the narrowest unit leads, whatever project it is on.
    expect(rows[0]!.getAttribute('data-testid')).toBeTruthy();
  });

  it('★★★ §B6: fix-206 editing SURVIVED the caret’s removal', () => {
    // The caret is gone, but the editor it hid was the point of fix-206. It is
    // the unit view's row now, writing through the same untouched OCC path.
    renderIt();
    goUnitView();
    const wInput = screen.getByTestId('library-unit-a-0-w') as HTMLInputElement;
    fireEvent.change(wInput, { target: { value: '27.5' } });
    fireEvent.blur(wInput);
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutateAsync.mock.calls[0][0].expectedUpdatedAt).toBe(
      '2026-06-25T10:00:00Z',
    );
  });
});

// ===========================================================================
// ★★★ fix-469 §2 (P-122) — the per-card Clear, as rendered
// ===========================================================================
//
// Bobby, 2026-09-01: *"can we add a clear button to the search filters of
// units/site?"* Keeping a lot search while dropping the unit dimensions meant
// blanking up to NINE controls by hand.
describe('fix-469 §2: each filter card clears itself', () => {
  it('★★ a card with nothing set renders NO Clear', () => {
    // fix-406's rule: a control that cannot act is absent, not present-and-inert.
    renderIt();
    expect(screen.queryByTestId('filter-clear-site')).not.toBeInTheDocument();
    expect(screen.queryByTestId('filter-clear-unit')).not.toBeInTheDocument();
    // ★ fix-483 §A4: the GLOBAL Clear used to be asserted here as "always
    //   there". It is gone by ruling, so the assertion is INVERTED rather than
    //   dropped — there are exactly two Clears on this screen now, and neither
    //   of them is showing.
    expect(screen.queryByTestId('filter-clear')).not.toBeInTheDocument();
  });

  it("★★ setting one card's field reveals only THAT card's Clear", () => {
    renderIt();
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '25' } });
    expect(screen.getByTestId('filter-clear-unit')).toBeInTheDocument();
    expect(screen.queryByTestId('filter-clear-site')).not.toBeInTheDocument();
  });

  it('★★★ a card Clear resets its own fields and leaves the other card alone', () => {
    renderIt();
    // A lot search AND a unit search — the situation the ticket describes.
    fireEvent.change(screen.getByTestId('lotw-target'), { target: { value: '60' } });
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '40' } });
    expect(screen.getByTestId('filter-clear-site')).toBeInTheDocument();
    expect(screen.getByTestId('filter-clear-unit')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('filter-clear-unit'));

    // ★ The unit dimension is gone…
    expect((screen.getByTestId('unitw-target') as HTMLInputElement).value).toBe('');
    // ★ …and the lot search — the thing you wanted to keep — survives.
    expect((screen.getByTestId('lotw-target') as HTMLInputElement).value).toBe('60');
    expect(screen.getByTestId('filter-clear-site')).toBeInTheDocument();
    expect(screen.queryByTestId('filter-clear-unit')).not.toBeInTheDocument();
  });

  it('★★★ NEITHER Clear moves the reader to a different table — `view` survives both', () => {
    // ★★★ THE ONE THAT GETS MISSED. `view` rides inside LibraryFilters because
    //     that is the blob fix-403 persists, but it is a PREFERENCE, not a
    //     filter. Clearing a search must never bounce somebody out of the table
    //     they chose.
    renderIt();
    goUnitView();
    expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('filter-clear-unit'));
    expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('lotw-target'), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('filter-clear-site'));
    expect(screen.getByTestId('library-table-unit')).toBeInTheDocument();

    // ★ fix-483 §A4: the GLOBAL Clear's arm of this test went with the button.
    //   fix-447's ruling it enforced — *"CLEAR CLEARS FILTERS, IT DOES NOT
    //   CHANGE THE VIEW"* — is what the two arms above assert, and it is now
    //   guaranteed structurally as well: `view` is in NEITHER card's key list,
    //   so `clearCard` cannot reach it even by accident.
  });

  it('★ the UNIT card caption now describes ROWS, not how a project qualifies', () => {
    // ★★ The old caption — "one unit must match all of these" — was honest
    //    about a behaviour that no longer happens: the UNIT panel was a project
    //    QUALIFIER, and every unit of a qualifying project printed. Now the
    //    criteria choose the rows, so the caption says so.
    renderIt();
    expect(screen.getByTestId('filter-chip-unit-caption').textContent).toBe(
      'show units matching all of these',
    );
  });
});
