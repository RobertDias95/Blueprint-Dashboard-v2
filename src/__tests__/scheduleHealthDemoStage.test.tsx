import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

// fix-188: render the REAL ScheduleHealthTable with the exact BLD2026-0536
// (Edmonds Demolition) prod data and assert the Stage cell reads "Permitting"
// (under review), NOT "Corrections" — the only review cycle has no corr_issued
// and a reviewer (Trees) still in_review, so the round isn't complete.

const T = 'test-tenant-uuid';
const NOW = '2026-05-14T12:00:00Z';

const refs = vi.hoisted(() => ({
  reviewers: [] as Record<string, unknown>[],
}));

const demoPermit = {
  id: 10231,
  project_id: 'edmonds-1',
  type: 'Demolition',
  stage: 'de',
  stage_override: null,
  status: 'Applied',
  num: 'BLD2026-0536',
  da: null, dm: null, ent_lead: null, dual_da: null,
  target_submit: null, dd_start: null, dd_end: null,
  expected_issue: null, actual_issue: null, approval_date: null,
  intake_date: null, notes: null, cycle_model: null, view_cycle: null,
  kickoff_date: null, corr_rounds: 0, permit_owner: null, architect: null,
  nickname: null, struct_address: null, portal_url: null, updated_at: NOW,
  extras: null,
  permit_cycles: [
    { id: 'c0', permit_id: 10231, cycle_index: 0, submitted: '2026-04-30', intake_accepted: '2026-05-01', city_target: null, corr_issued: null, resubmitted: null, created_at: NOW, updated_at: NOW },
    { id: 'c1', permit_id: 10231, cycle_index: 1, submitted: '2026-04-30', intake_accepted: null, city_target: '2026-06-22', corr_issued: null, resubmitted: null, created_at: NOW, updated_at: NOW },
  ],
};

const demoProject = {
  id: 'edmonds-1', address: '224 2nd Ave N', juris: 'Edmonds', archived: false, notes: null,
  created_at: NOW, updated_at: NOW,
};

vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: refs.reviewers, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [demoPermit], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [demoProject], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermitTypeDefaults', () => ({
  usePermitTypeDefaults: () => ({ data: [], rows: [], byType: new Map(), c1OffsetByType: new Map(), isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  holdsByProjectId: () => new Map(),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock('../hooks/usePermitTasks', () => ({
  usePermitTasks: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

import ScheduleHealthTable from '../components/ProjectDetail/ScheduleHealthTable';

function rev(discipline: string, status: string) {
  return {
    id: `r-${discipline}`, tenant_id: T, permit_id: 10231, cycle_index: 1,
    reviewer_name: discipline, discipline, current_status: status,
    last_event_date: null, created_at: NOW, updated_at: NOW,
  };
}

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ScheduleHealthTable permits={[demoPermit as any]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  refs.reviewers = [
    rev('engineering', 'corrections_required'),
    rev('planning', 'corrections_required'),
    rev('trees', 'in_review'),
  ];
});

describe('ScheduleHealthTable — BLD2026-0536 Stage cell (fix-188)', () => {
  it('renders "Permitting" (under review), NOT "Corrections", for the exact prod data', () => {
    renderTable();
    const row = screen.getByTestId('schedule-health-row-10231');
    // Stage cell + status cell text: the permit reads Permitting / City Target,
    // not Corrections. (The reviewer chip's "2⚠" is a per-discipline count, not
    // the stage word.)
    expect(row.textContent).toContain('Permitting');
    expect(within(row).queryByText('Corrections')).toBeNull();
  });

  it('flips to "Corrections" only once every reviewer has acted (Trees → corrections)', () => {
    refs.reviewers = [
      rev('engineering', 'corrections_required'),
      rev('planning', 'corrections_required'),
      rev('trees', 'corrections_required'),
    ];
    renderTable();
    const row = screen.getByTestId('schedule-health-row-10231');
    expect(row.textContent).toContain('Corrections');
  });
});
