import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// Q6.1: behavior tests for DrawScheduleGrid. Mocks the four hooks the
// component composes so the test can drive layout + filter behavior
// without touching Supabase.

const T = 'test-tenant-uuid';

const fixtures = vi.hoisted(() => ({
  draw: [
    {
      project_id: 'p-now',
      da_assigned: 'Trevor',
      start_week: '2026-05-04',
      end_week: '2026-05-18',
      status: 'Submitted',
      manual_status: null,
      manually_placed: true,
      dd_start: '2026-05-04',
      dd_end: '2026-05-22',
      notes: null,
      color_override: null,
      status_override: null,
      updated_at: '2026-05-09T12:00:00Z',
    },
    {
      project_id: 'p-other',
      da_assigned: 'Ahmadi',
      start_week: '2026-05-04',
      end_week: '2026-05-11',
      status: 'Approved',
      manual_status: null,
      manually_placed: true,
      dd_start: '2026-05-04',
      dd_end: '2026-05-15',
      notes: null,
      color_override: null,
      status_override: null,
      updated_at: '2026-05-09T12:00:00Z',
    },
    {
      project_id: 'p-noda',
      da_assigned: null,
      start_week: null,
      end_week: null,
      status: null,
      manual_status: null,
      manually_placed: false,
      dd_start: null,
      dd_end: null,
      notes: null,
      color_override: null,
      status_override: null,
      updated_at: '2026-05-09T12:00:00Z',
    },
  ],
  projects: [
    { id: 'p-now', address: '500 Pike St', juris: 'Seattle', archived: false, notes: null },
    { id: 'p-other', address: '750 Oak Way', juris: 'Bellevue', archived: false, notes: null },
    { id: 'p-noda', address: '999 Unscheduled Ln', juris: 'Seattle', archived: false, notes: null },
  ],
  groups: [
    { dm: 'Lindsay', das: ['Francesca', 'Ainsley', 'Trevor'] },
    { dm: 'Brittani', das: ['Marc', 'Ahmadi', 'Fisk'] },
  ],
}));

vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({
    data: fixtures.draw,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: fixtures.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    groups: fixtures.groups,
  }),
}));

import DrawScheduleGrid from '../components/DrawScheduleGrid';

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

function renderGrid() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<DrawScheduleGrid />, { wrapper });
}

describe('<DrawScheduleGrid />', () => {
  it('renders DM + DA header rows and a column per DA', () => {
    renderGrid();
    expect(screen.getByText('Lindsay')).toBeInTheDocument();
    expect(screen.getByText('Brittani')).toBeInTheDocument();
    // 6 total DAs across the two groups.
    for (const da of ['Francesca', 'Ainsley', 'Trevor', 'Marc', 'Ahmadi', 'Fisk']) {
      expect(screen.getByText(da)).toBeInTheDocument();
      expect(screen.getByTestId(`da-col-${da}`)).toBeInTheDocument();
    }
  });

  it('places scheduled project blocks inside their DA columns', () => {
    renderGrid();
    // p-now is on Trevor; p-other is on Ahmadi. Both should render as blocks.
    expect(screen.getByTestId('block-p-now')).toBeInTheDocument();
    expect(screen.getByTestId('block-p-other')).toBeInTheDocument();
  });

  it('puts unassigned projects in the Unscheduled lane', () => {
    renderGrid();
    expect(screen.getByTestId('unscheduled-p-noda')).toBeInTheDocument();
    expect(screen.getByText('999 Unscheduled Ln')).toBeInTheDocument();
  });

  it('search filter narrows the visible blocks', () => {
    renderGrid();
    expect(screen.getByTestId('block-p-now')).toBeInTheDocument();
    expect(screen.getByTestId('block-p-other')).toBeInTheDocument();

    const search = screen.getByTestId('schedule-search');
    fireEvent.change(search, { target: { value: 'pike' } });

    expect(screen.getByTestId('block-p-now')).toBeInTheDocument();
    expect(screen.queryByTestId('block-p-other')).not.toBeInTheDocument();
  });

  it('quarter navigator advances + rewinds, and "today" snaps back', () => {
    renderGrid();
    const nav = screen.getByTestId('quarter-today');
    const initial = nav.textContent ?? '';

    fireEvent.click(screen.getByTestId('quarter-next'));
    const next = nav.textContent ?? '';
    expect(next).not.toBe(initial);

    fireEvent.click(screen.getByTestId('quarter-prev'));
    expect(nav.textContent).toBe(initial);

    fireEvent.click(screen.getByTestId('quarter-prev'));
    expect(nav.textContent).not.toBe(initial);

    // "Today" snaps offset back to 0 → label matches initial again.
    fireEvent.click(screen.getByTestId('quarter-today'));
    expect(nav.textContent).toBe(initial);
  });
});
