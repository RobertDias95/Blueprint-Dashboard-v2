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
      lot_size_sf: null,
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
      lot_size_sf: null,
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
      lot_size_sf: null,
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
      lot_size_sf: null,
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
      lot_size_sf: null,
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
      lot_size_sf: null,
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

beforeEach(() => {
  updateMutateAsync.mockReset();
  updateMutateAsync.mockResolvedValue({ id: 'a', updated_at: '2026-06-25T11:00:00Z' });
  appConfigMap.current = new Map<string, unknown>();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
    // ★★ fix-403 keys the stored filters on the LOGIN (fix-176's rule), so
    //    the harness needs a user id for persistence to happen at all.
    user: { id: 'u-403' } as never,
  });
  window.sessionStorage.clear();
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


// ===========================================================================
// fix-403 — THE ROUND TRIP, RENDERED
// ===========================================================================
//
// Bobby: *"I click the project and I go into Project Overview and then I
// realize, ah, I'm going to keep searching. I would like to click the previous
// button. It takes me back to the library and then it still has all of my
// saved parameters."*
//
// ★★★ THE UNIT TESTS PROVE THE ENCODER; THIS PROVES THE WIRING. A perfectly
// correct load/save pair is worth nothing if the panel never calls it, or calls
// it in an effect that runs after the first paint. Unmounting and remounting
// the real component is the closest a jsdom test gets to leaving the page and
// coming back — through the Previous button, the browser's back button or the
// ribbon, all three of which land here identically because the memory lives in
// sessionStorage rather than in router state.

describe('fix-403: the Library filter panel survives leaving the page', () => {
  // ★ fix-483 §A4: `library-search` left this reader with the box. Every other
  //   field is unchanged, and the claim — the panel remembers — is the same.
  const read = () => ({
    zone: (screen.getByTestId('filter-zone') as HTMLInputElement).value,
    corner: (screen.getByTestId('filter-corner') as HTMLSelectElement).value,
    parking: (screen.getByTestId('filter-parking-kind') as HTMLSelectElement).value,
    stalls: (screen.getByTestId('filter-stalls') as HTMLSelectElement).value,
    deck: (screen.getByTestId('filter-roof-deck') as HTMLSelectElement).value,
  });

  function setFilters() {
    fireEvent.change(screen.getByTestId('filter-zone'), { target: { value: 'NR' } });
    fireEvent.change(screen.getByTestId('filter-corner'), { target: { value: 'Yes' } });
    fireEvent.change(screen.getByTestId('filter-parking-kind'), { target: { value: 'garage' } });
    fireEvent.change(screen.getByTestId('filter-stalls'), { target: { value: '1+' } });
    fireEvent.change(screen.getByTestId('filter-roof-deck'), { target: { value: 'Yes' } });
  }

  it('★★★ every filter comes back — SITE card and UNIT card', () => {
    const first = renderIt();
    setFilters();
    const before = read();
    first.unmount();

    renderIt();
    expect(read()).toEqual(before);
  });

  // ★★★ fix-483 §A4: this pressed the PAGE-LEVEL Clear, which is gone by
  //     ruling. The claim it proves is fix-469 §2's now — a Clear that only
  //     reset React state would restore every filter on the next visit — so it
  //     is re-made through the TWO CARD CLEARS, which is strictly more work for
  //     the code: two buttons, each writing its own subset back to storage.
  it('★★★ the card Clears wipe it, and the wipe SURVIVES the round trip too', () => {
    const first = renderIt();
    setFilters();
    fireEvent.click(screen.getByTestId('filter-clear-site'));
    fireEvent.click(screen.getByTestId('filter-clear-unit'));
    first.unmount();

    renderIt();
    expect(read()).toEqual({
      zone: '', corner: '', parking: '', stalls: '', deck: '',
    });
  });

  it('★★ a FRESH TAB starts clean', () => {
    const first = renderIt();
    setFilters();
    first.unmount();

    window.sessionStorage.clear(); // what a new tab sees
    renderIt();
    expect(read().zone).toBe('');
  });

  it('★★ ...and the count follows the restored filters, not just the inputs', () => {
    // The inputs coming back is not enough — the LIST has to be filtered by
    // them. A restore that repopulated the controls without re-running the
    // filter would look right and show everything.
    const first = renderIt();
    fireEvent.change(screen.getByTestId('filter-corner'), { target: { value: 'Yes' } });
    const filteredCount = screen.getByTestId('library-count').textContent;
    first.unmount();

    renderIt();
    expect(screen.getByTestId('library-count').textContent).toBe(filteredCount);
  });
});
