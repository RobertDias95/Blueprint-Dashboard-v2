import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-25-II D2: approval_date / actual_issue are permit-level fields that
// rendered unconditionally on every cycle strip — the same stale date
// surfaced on cycle 1, 2, 3, etc. The fix pins each to its anchor cycle
// (highest cycle_index whose submitted is <= the milestone date) and
// renders a placeholder on the other cycle strips so the grid stays
// aligned but the date is no longer attributed to the wrong cycle.

vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpsertPermitCycle', () => ({
  useUpsertPermitCycle: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDeletePermitCycle', () => ({
  useDeletePermitCycle: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useUpsertPermitTask', () => ({
  useUpsertPermitTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDeletePermitTask', () => ({
  useDeletePermitTask: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/usePermitTasks', () => ({
  usePermitTasks: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../components/ProjectDetail/ScheduleEstimator', () => ({
  default: () => <div data-testid="stub-schedule-estimator" />,
}));

import PermitDetailV2 from '../components/ProjectDetail/PermitDetailV2';

function makeCycle(
  over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>,
): PermitCycle {
  return {
    id: `c-${over.cycle_index}`,
    permit_id: 11011,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-05-14T12:00:00Z',
    updated_at: '2026-05-14T12:00:00Z',
    ...over,
  };
}

function makePermit(
  cycles: PermitCycle[],
  over: Partial<PermitWithCycles> = {},
): PermitWithCycles {
  return {
    id: 11011,
    project_id: 'p-test',
    type: 'Building Permit',
    stage: 'co',
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
    updated_at: '2026-05-14T12:00:00Z',
    permit_cycles: cycles,
    ...over,
  };
}

function renderWithClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<>{node}</>, { wrapper });
}

beforeEach(() => {
  // Each test re-renders fresh; no shared state to reset.
});

describe('PermitDetailV2 fix-25-II D2 — approval / actual_issue anchor cycle', () => {
  it('approval_date set: editable cell appears only on the anchor cycle', () => {
    // Two review cycles: cycle 1 submitted 2026-01-15, cycle 2 submitted
    // 2026-03-10. approval_date = 2026-02-20 → highest cycle_index with
    // submitted <= approval_date is cycle 1.
    const permit = makePermit(
      [
        makeCycle({
          cycle_index: 1,
          submitted: '2026-01-15',
          corr_issued: '2026-02-10',
          resubmitted: '2026-03-10',
        }),
        makeCycle({ cycle_index: 2, submitted: '2026-03-10' }),
      ],
      { approval_date: '2026-02-20' },
    );
    renderWithClient(<PermitDetailV2 permit={permit} />);

    // Cycle 1 tab: editable approval cell
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const c1Approval = screen
      .getByTestId('pd-cell-approval_date')
      .querySelector('input') as HTMLInputElement;
    expect(c1Approval.value).toBe('2026-02-20');

    // Cycle 2 tab: placeholder, no editable approval input
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-2'));
    expect(screen.queryByTestId('pd-cell-approval_date')).toBeNull();
    const placeholder = screen.getByTestId(
      'pd-cell-approval_date-placeholder-cycle2',
    );
    expect(placeholder.textContent).toMatch(/cycle 1/);
    expect(placeholder.querySelector('input')).toBeNull();
  });

  it('approval_date unset: editable cell pinned to the latest cycle', () => {
    const permit = makePermit(
      [
        makeCycle({ cycle_index: 1, submitted: '2026-01-15' }),
        makeCycle({ cycle_index: 2, submitted: '2026-03-10' }),
      ],
      { approval_date: null },
    );
    renderWithClient(<PermitDetailV2 permit={permit} />);

    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    expect(screen.queryByTestId('pd-cell-approval_date')).toBeNull();
    expect(
      screen.getByTestId('pd-cell-approval_date-placeholder-cycle1'),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-2'));
    const c2Approval = screen
      .getByTestId('pd-cell-approval_date')
      .querySelector('input') as HTMLInputElement;
    expect(c2Approval).toBeTruthy();
    expect(c2Approval.value).toBe('');
  });

  it('actual_issue set after approval: anchors on the cycle whose submitted is on/before it', () => {
    // approval_date 2026-02-20 + actual_issue 2026-04-05. Submissions:
    // cycle 1 = 2026-01-15, cycle 2 = 2026-03-10. Approval anchor = cycle 1
    // (submitted <= approval), Issue anchor = cycle 2 (submitted <= issue).
    const permit = makePermit(
      [
        makeCycle({
          cycle_index: 1,
          submitted: '2026-01-15',
          corr_issued: '2026-02-10',
          resubmitted: '2026-03-10',
        }),
        makeCycle({ cycle_index: 2, submitted: '2026-03-10' }),
      ],
      {
        approval_date: '2026-02-20',
        actual_issue: '2026-04-05',
      },
    );
    renderWithClient(<PermitDetailV2 permit={permit} />);

    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    expect(
      (screen.getByTestId('pd-cell-approval_date').querySelector('input') as HTMLInputElement)
        .value,
    ).toBe('2026-02-20');
    // Actual issue NOT on cycle 1
    expect(screen.queryByTestId('pd-cell-actual_issue')).toBeNull();
    expect(
      screen.getByTestId('pd-cell-actual_issue-placeholder-cycle1'),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-2'));
    // Approval NOT on cycle 2
    expect(screen.queryByTestId('pd-cell-approval_date')).toBeNull();
    expect(
      screen.getByTestId('pd-cell-approval_date-placeholder-cycle2'),
    ).toBeTruthy();
    // Actual Issue IS on cycle 2
    expect(
      (screen.getByTestId('pd-cell-actual_issue').querySelector('input') as HTMLInputElement)
        .value,
    ).toBe('2026-04-05');
  });
});
