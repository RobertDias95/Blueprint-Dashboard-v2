import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getQuarterWeeks } from '../lib/drawScheduleHelpers';

// fix-100: once a Building Permit is actually approved, the Draw
// Schedule block should label the date "Approval" — not "Est. Approval".
// computeProjectedApproval already returns isActual=true in that case;
// the renderer just needed to thread the flag through and pick the
// shorter label. These tests mock the projection's isActual to flip
// both branches of the label.

const T = 'test-tenant-uuid';
const W = getQuarterWeeks(0);

type DrawRow = {
  project_id: string;
  da_assigned: string | null;
  start_week: string | null;
  end_week: string | null;
  status: string | null;
  manual_status: boolean | null;
  manually_placed: boolean | null;
  dd_start: string | null;
  dd_end: string | null;
  notes: string | null;
  color_override: string | null;
  status_override: string | null;
  updated_at: string;
};

function row(over: Partial<DrawRow>): DrawRow {
  return {
    project_id: 'x',
    da_assigned: 'A1',
    start_week: W[3],
    end_week: W[5],
    status: 'Approved',
    manual_status: null,
    manually_placed: true,
    dd_start: null,
    dd_end: null,
    notes: null,
    color_override: null,
    status_override: null,
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const refs = vi.hoisted(() => ({
  draw: { current: [] as unknown[] },
  projects: { current: [] as unknown[] },
  permits: { current: [] as unknown[] },
  np: { current: [] as unknown[] },
  // fix-100: per-test override for computeProjectedApproval. Returning
  // isActual=true simulates a BP that's already approved.
  projection: { current: { projection: '2026-08-15', isActual: false } as {
    projection: string | null;
    isActual: boolean;
  } },
}));

vi.mock('../lib/projectedApproval', () => ({
  computeProjectedApproval: () => refs.projection.current,
}));

vi.mock('../hooks/useDrawSchedule', () => ({
  useDrawSchedule: () => ({
    data: refs.draw.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: refs.projects.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: refs.permits.current,
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
    groups: [{ dm: 'DM1', das: ['A1', 'A2'] }],
  }),
}));
vi.mock('../hooks/useDaTimeBlocks', () => ({
  useDaTimeBlocks: () => ({
    data: refs.np.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
const noopMut = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
  reset: vi.fn(),
};
vi.mock('../hooks/useUpdateDrawSchedule', () => ({
  useUpdateDrawSchedule: () => noopMut,
}));
vi.mock('../hooks/useResolveDaOverlap', () => ({
  useResolveDaOverlap: () => noopMut,
}));
vi.mock('../hooks/useMoveDrawScheduleDa', () => ({
  useMoveDrawScheduleDa: () => noopMut,
}));
vi.mock('../hooks/useShiftDaBlocksUp', () => ({
  useShiftDaBlocksUp: () => noopMut,
}));
vi.mock('../hooks/useUpsertDaTimeBlock', () => ({
  useUpsertDaTimeBlock: () => noopMut,
}));
vi.mock('../hooks/useDeleteDaTimeBlock', () => ({
  useDeleteDaTimeBlock: () => noopMut,
}));
vi.mock('../hooks/useResizeDaTimeBlock', () => ({
  useResizeDaTimeBlock: () => noopMut,
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [],
    activeDas: [],
    formerDas: [],
    dms: [],
    ents: [],
    acqs: [],
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import DrawScheduleGrid from '../components/DrawScheduleGrid';

function project(id: string, address: string, juris = 'Seattle') {
  return { id, address, juris, archived: false, notes: null };
}

function renderGrid() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<DrawScheduleGrid />, { wrapper });
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  refs.draw.current = [];
  refs.projects.current = [];
  refs.permits.current = [];
  refs.np.current = [];
  // Default: estimator output that ISN'T an actual approval.
  refs.projection.current = { projection: '2026-08-15', isActual: false };
});

describe('Draw Schedule block — fix-100 approval label', () => {
  it('label is "Est. Approval" when the projection is an estimate (BP.approval_date is null)', () => {
    refs.projection.current = { projection: '2026-08-15', isActual: false };
    refs.draw.current = [
      row({ project_id: 'p1', da_assigned: 'A1', start_week: W[3], end_week: W[6] }),
    ];
    refs.projects.current = [project('p1', '500 Pike St')];
    refs.permits.current = [
      // approval_date intentionally absent — estimator path.
      {
        id: 1,
        project_id: 'p1',
        type: 'Building Permit',
        permit_cycles: [],
        extras: {},
      },
    ];
    renderGrid();
    const est = screen.getByTestId('block-est-approval-p1');
    expect(est.textContent).toContain('Est. Approval');
    expect(est.textContent).not.toMatch(/(^|\s)Approval\s+\d/);
    expect(est).toHaveAttribute('data-actual', 'false');
    expect(est).toHaveAttribute(
      'title',
      'Est. Approval — 2026-08-15',
    );
  });

  it('label drops the "Est." prefix and becomes "Approval" once BP.approval_date is set', () => {
    // computeProjectedApproval short-circuits to isActual=true when
    // permit.approval_date is populated. Mirror that behavior here.
    refs.projection.current = {
      projection: '2026-04-15',
      isActual: true,
    };
    refs.draw.current = [
      row({ project_id: 'p2', da_assigned: 'A2', start_week: W[3], end_week: W[6] }),
    ];
    refs.projects.current = [project('p2', '800 Approved Ave')];
    refs.permits.current = [
      {
        id: 1,
        project_id: 'p2',
        type: 'Building Permit',
        permit_cycles: [],
        extras: {},
        approval_date: '2026-04-15',
      },
    ];
    renderGrid();
    const cell = screen.getByTestId('block-est-approval-p2');
    expect(cell).toHaveAttribute('data-actual', 'true');
    expect(cell.textContent).toContain('Approval');
    expect(cell.textContent).not.toContain('Est. Approval');
    expect(cell.textContent).toContain('04-15-26');
    expect(cell).toHaveAttribute('title', 'Approval — 2026-04-15');
  });

  it('compact (1-week) block uses the shorter "Approval" label too when isActual', () => {
    // The brief calls out space-constrained blocks. The shorter label
    // is the same on compact blocks; verify the path renders + flags
    // correctly when the block is a single week.
    refs.projection.current = {
      projection: '2026-04-15',
      isActual: true,
    };
    refs.draw.current = [
      row({ project_id: 'p3', da_assigned: 'A1', start_week: W[3], end_week: W[3] }),
    ];
    refs.projects.current = [project('p3', '12 One Week Way')];
    refs.permits.current = [
      {
        id: 1,
        project_id: 'p3',
        type: 'Building Permit',
        permit_cycles: [],
        extras: {},
        approval_date: '2026-04-15',
      },
    ];
    renderGrid();
    const cell = screen.getByTestId('block-est-approval-p3');
    expect(cell.textContent).toContain('Approval');
    expect(cell.textContent).not.toContain('Est. Approval');
    expect(cell).toHaveAttribute('data-actual', 'true');
  });

  it('null projection still renders nothing (no projection => no label at all)', () => {
    refs.projection.current = { projection: null, isActual: false };
    refs.draw.current = [
      row({ project_id: 'p4', da_assigned: 'A1', start_week: W[3], end_week: W[6] }),
    ];
    refs.projects.current = [project('p4', '99 Empty St')];
    refs.permits.current = [
      {
        id: 1,
        project_id: 'p4',
        type: 'Building Permit',
        permit_cycles: [],
        extras: {},
      },
    ];
    renderGrid();
    expect(screen.queryByTestId('block-est-approval-p4')).toBeNull();
  });
});
