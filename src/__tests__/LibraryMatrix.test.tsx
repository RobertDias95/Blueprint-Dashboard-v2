import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// Q6.3.a: smoke tests for LibraryMatrix. Mocks the two read hooks so the
// component renders synchronously with a fixed dataset; verifies row
// rendering, filter narrowing, sort toggling, and the empty state.

const T = 'test-tenant-uuid';

// fix-22 Mig 3: physical fields (units/zone/lot_*/alley/product_type/
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
      zone: 'NR',
      lot_width: 40,
      lot_depth: 100,
      alley: 'Yes',
      product_types: ['SFR'],
      project_tags: ['ECA'],
      // fix-81: three Cottages — narrow + short. Used by the
      // unit-width filter test (25 ± 2 matches all three) and the
      // search-by-unit-name test ("cottage" surfaces this project).
      unit_types: [
        { label: 'Cottage 1', width_ft: 25, depth_ft: 60, qty: 1 },
        { label: 'Cottage 2', width_ft: 25, depth_ft: 60, qty: 1 },
        { label: 'Cottage 3', width_ft: 25, depth_ft: 60, qty: 1 },
      ],
    },
    {
      id: 'b',
      address: '300 Oak Ln',
      juris: 'Bellevue',
      archived: false,
      notes: null,
      units: 5,
      zone: 'R-2',
      lot_width: 60,
      lot_depth: 120,
      alley: 'No',
      product_types: ['Attached Units'],
      project_tags: ['SIP'],
      // One SFR unit at 40×80 — used by the unit-width filter test
      // (target 40 ± 2 matches this row's unit, none of project a's
      // 25-wide cottages).
      unit_types: [
        { label: 'SFR 1', width_ft: 40, depth_ft: 80, qty: 1 },
      ],
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

import LibraryMatrix from '../components/LibraryMatrix';

beforeEach(() => {
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

  it('search filter narrows by address tokens', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('library-search'), {
      target: { value: 'pike' },
    });
    expect(screen.getByTestId('library-row-c')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
  });

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

  it('Clear button resets all filters', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('filter-juris'), {
      target: { value: 'Seattle' },
    });
    expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('filter-clear'));
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.getByTestId('library-count').textContent).toMatch(/^3 projects/);
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

  it('shows the empty state when filters exclude every row', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('library-search'), {
      target: { value: 'nonexistent-address-token' },
    });
    expect(screen.getByText(/No projects match/i)).toBeInTheDocument();
    expect(screen.getByTestId('library-count').textContent).toMatch(/^0 projects/);
  });

  // fix-81: per-row caret expands a nested mini-table that lists every
  // unit_type on the project (name + width + depth + qty).
  it('clicking the caret expands a row to show its unit_types', () => {
    renderIt();
    // Default: collapsed; mini-table should not be in the DOM.
    expect(screen.queryByTestId('library-unit-table-a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('library-caret-a'));
    const miniTable = screen.getByTestId('library-unit-table-a');
    expect(miniTable).toBeInTheDocument();
    // All three Cottage rows visible with the right label + dims.
    expect(screen.getByTestId('library-unit-row-a-0').textContent).toContain('Cottage 1');
    expect(screen.getByTestId('library-unit-row-a-0').textContent).toContain('25');
    expect(screen.getByTestId('library-unit-row-a-0').textContent).toContain('60');
    expect(screen.getByTestId('library-unit-row-a-1').textContent).toContain('Cottage 2');
    expect(screen.getByTestId('library-unit-row-a-2').textContent).toContain('Cottage 3');
  });

  it('projects with no unit_types do not render an expand caret', () => {
    renderIt();
    expect(screen.queryByTestId('library-caret-c')).not.toBeInTheDocument();
  });

  it('unit-width target ± buf filters by per-unit dim and auto-expands + highlights matches', () => {
    renderIt();
    // Target 40 ± 2 → matches [38, 42]. Project a's cottages are 25 wide
    // (out). Project b's SFR 1 is 40 wide (in). Project c has no units
    // (drops when unit filter is active).
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '40' } });
    expect(screen.queryByTestId('library-row-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
    // Auto-expanded because the unit filter is active.
    expect(screen.getByTestId('library-unit-table-b')).toBeInTheDocument();
    // The matching unit row is flagged via data-matched="true".
    expect(
      screen.getByTestId('library-unit-row-b-0').getAttribute('data-matched'),
    ).toBe('true');
  });

  it('unit-width filter narrows project a to its Cottage rows (all three match 25 ± 2)', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '25' } });
    expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
    // All three Cottages highlight.
    expect(screen.getByTestId('library-unit-row-a-0').getAttribute('data-matched')).toBe('true');
    expect(screen.getByTestId('library-unit-row-a-1').getAttribute('data-matched')).toBe('true');
    expect(screen.getByTestId('library-unit-row-a-2').getAttribute('data-matched')).toBe('true');
  });

  it('search by unit_type name surfaces projects with a matching unit (e.g. "cottage")', () => {
    renderIt();
    fireEvent.change(screen.getByTestId('library-search'), {
      target: { value: 'cottage' },
    });
    expect(screen.getByTestId('library-row-a')).toBeInTheDocument();
    expect(screen.queryByTestId('library-row-b')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-row-c')).not.toBeInTheDocument();
  });

  it('clicking the caret on an auto-expanded row collapses it', () => {
    renderIt();
    // Activate the unit filter so a auto-expands.
    fireEvent.change(screen.getByTestId('unitw-target'), { target: { value: '25' } });
    expect(screen.getByTestId('library-unit-table-a')).toBeInTheDocument();
    // Toggle off via the caret.
    fireEvent.click(screen.getByTestId('library-caret-a'));
    expect(screen.queryByTestId('library-unit-table-a')).not.toBeInTheDocument();
  });
});
