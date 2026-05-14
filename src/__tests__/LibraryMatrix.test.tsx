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
      product_type: 'SFR',
      project_tags: ['ECA'],
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
      product_type: 'Attached Units',
      project_tags: ['SIP'],
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
      product_type: 'SFR',
      project_tags: [],
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
      product_type: 'SFR',
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
      product_type: 'Attached Units',
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
      product_type: 'SFR',
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
});
