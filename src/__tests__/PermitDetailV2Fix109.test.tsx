import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-109: smart Add Cycle + cycle tab display sanity.
//
//   Part A (smart Add Cycle): the new cycle's submitted date is
//     seeded from the currently viewed cycle's resubmitted (preferred)
//     or corr_issued (fallback, with a helper caption). The button
//     disables with a tooltip when neither field is set. After the
//     insert resolves, the view switches to the new cycle.
//
//   Part B (tab display sanity): CycleTabBar no longer filters out
//     empty trailing cycles. Pre-fix any cycle_index > 1 with all-null
//     fields was hidden unless it was the viewed cycle — that's how
//     Bobby's 6505 21st Ave NW accumulated 5 phantom empty cycles
//     without seeing them in the bar.
//
//   Part C (orphan cleanup): when the viewed cycle (cycle_index > 0)
//     has no data, an "Empty cycle … delete?" hint renders between
//     the tab bar and the date strip with a Delete button that calls
//     useDeletePermitCycle and switches the view back to the previous
//     cycle on success.

const cycleMutateAsync = vi.hoisted(() => vi.fn());
const cycleDeleteMutate = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('../hooks/useUpsertPermitCycle', () => ({
  useUpsertPermitCycle: () => ({
    mutateAsync: cycleMutateAsync,
    mutate: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('../hooks/useDeletePermitCycle', () => ({
  useDeletePermitCycle: () => ({
    mutate: cycleDeleteMutate,
    isPending: false,
  }),
}));
vi.mock('../hooks/useUpsertPermitTask', () => ({
  useUpsertPermitTask: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
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
    permit_id: 10009,
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

function makePermit(cycles: PermitCycle[]): PermitWithCycles {
  return {
    id: 10009,
    project_id: 'p-test',
    type: 'Building Permit',
    stage: 'pm',
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
  };
}

function renderWithClient(permit: PermitWithCycles) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<PermitDetailV2 permit={permit} />, { wrapper });
}

beforeEach(() => {
  cycleMutateAsync.mockReset();
  cycleMutateAsync.mockResolvedValue({});
  cycleDeleteMutate.mockReset();
});

describe('PermitDetailV2 fix-109 — smart Add Cycle', () => {
  it('seeds the new cycle\'s submitted from the viewed cycle\'s resubmitted', async () => {
    // Cycle 1 has resubmitted=2026-04-06. Click Add Cycle → new cycle
    // 2 inserted with submitted=2026-04-06.
    const permit = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-03-01',
        resubmitted: '2026-04-06',
      }),
    ]);
    renderWithClient(permit);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const btn = screen.getByTestId('pd-v2-add-cycle');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(cycleMutateAsync).toHaveBeenCalledTimes(1));
    const payload = cycleMutateAsync.mock.calls[0][0];
    expect(payload).toMatchObject({
      op: 'insert',
      permitId: 10009,
      cycleIndex: 2,
      patch: { submitted: '2026-04-06' },
    });
  });

  it('falls back to corr_issued when resubmitted is unset and surfaces a helper caption', async () => {
    // Cycle 1 has corr_issued but no resubmitted. The new cycle's
    // submitted is seeded from corr_issued; the caption flags it as a
    // stand-in.
    const permit = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-01-01',
        corr_issued: '2026-02-12',
      }),
    ]);
    renderWithClient(permit);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const seed = screen.getByTestId('pd-v2-add-cycle-seed');
    expect(seed.textContent).toContain('Pre-filled from corrections date');
    expect(seed.textContent).toContain('2026-02-12');
    const btn = screen.getByTestId('pd-v2-add-cycle');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(cycleMutateAsync).toHaveBeenCalledTimes(1));
    expect(cycleMutateAsync.mock.calls[0][0].patch).toEqual({
      submitted: '2026-02-12',
    });
  });

  it('disables Add Cycle when the viewed cycle has neither resubmitted nor corr_issued', () => {
    // Cycle 0 has only submitted+intake_accepted; the user is on
    // Design. There's no seed source for a new cycle yet.
    const permit = makePermit([
      makeCycle({
        cycle_index: 0,
        submitted: '2026-01-01',
        intake_accepted: '2026-01-05',
      }),
    ]);
    renderWithClient(permit);
    // Default view is Design (cycle 0). Add Cycle button is rendered
    // inside the Cycle History sidebar widget only when at least one
    // review cycle exists — but with cycle 0 only, the widget shows
    // the empty-state message and no button. Let's seed a review
    // cycle that has no seed source either.
    const permit2 = makePermit([
      makeCycle({ cycle_index: 1, submitted: '2026-03-01' }), // no corr_issued / no resubmitted
    ]);
    renderWithClient(permit2);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const btn = screen.getByTestId('pd-v2-add-cycle');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/Set Resubmitted/i);
  });
});

describe('PermitDetailV2 fix-109 — cycle tab display sanity', () => {
  it('renders one tab per cycle row regardless of whether its fields are populated', () => {
    // Cycle 0 with data, cycle 1 with data, cycle 2 completely empty.
    // Pre-fix-109 the trailing-empty filter would have hidden cycle 2's
    // tab unless it was the viewed cycle — that's the bug Bobby's
    // 6505 case repro'd 5 times in a row.
    const permit = makePermit([
      makeCycle({
        cycle_index: 0,
        submitted: '2026-01-01',
        intake_accepted: '2026-01-05',
      }),
      makeCycle({
        cycle_index: 1,
        submitted: '2026-02-01',
        corr_issued: '2026-03-05',
        resubmitted: '2026-04-06',
      }),
      makeCycle({ cycle_index: 2 }),
    ]);
    renderWithClient(permit);
    expect(screen.getByTestId('pd-v2-cycle-tab-0')).toBeInTheDocument();
    expect(screen.getByTestId('pd-v2-cycle-tab-1')).toBeInTheDocument();
    expect(screen.getByTestId('pd-v2-cycle-tab-2')).toBeInTheDocument();
  });
});

describe('PermitDetailV2 fix-109 — empty cycle Delete affordance', () => {
  it('renders the empty-cycle hint + Delete button when viewing an empty review cycle', () => {
    const permit = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-02-01',
        corr_issued: '2026-03-05',
        resubmitted: '2026-04-06',
      }),
      makeCycle({ cycle_index: 2 }),
    ]);
    renderWithClient(permit);
    // Switch to cycle 2 — currentPhase derivation lands on cycle 1
    // (the most-advanced cycle with data), so we have to click into
    // the empty tab to view it.
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-2'));
    expect(screen.getByTestId('pd-v2-empty-cycle-hint-2')).toBeInTheDocument();
    expect(screen.getByTestId('pd-v2-empty-cycle-delete-2')).toBeInTheDocument();
  });

  it('Delete button calls useDeletePermitCycle and passes an onSuccess that switches view', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const permit = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-02-01',
        resubmitted: '2026-04-06',
      }),
      makeCycle({ cycle_index: 2 }),
    ]);
    renderWithClient(permit);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-2'));
    const btn = screen.getByTestId('pd-v2-empty-cycle-delete-2');
    fireEvent.click(btn);
    expect(cycleDeleteMutate).toHaveBeenCalledTimes(1);
    const call = cycleDeleteMutate.mock.calls[0][0];
    expect(call.cycle.cycle_index).toBe(2);
    expect(call.permitId).toBe(10009);
    // The mutation receives an onSuccess callback (the view-switch).
    const opts = cycleDeleteMutate.mock.calls[0][1];
    expect(opts).toMatchObject({ onSuccess: expect.any(Function) });
  });

  it('hides the empty-cycle hint when the viewed cycle has any data', () => {
    const permit = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-02-01',
      }),
    ]);
    renderWithClient(permit);
    expect(screen.queryByTestId('pd-v2-empty-cycle-hint-1')).toBeNull();
  });

  it('hides the empty-cycle hint on the Design tab even when fields are null', () => {
    // Design = cycle_index 0 is a virtual tab. The hint is gated on
    // viewIdx > 0 so the Design strip never shows it.
    const permit = makePermit([makeCycle({ cycle_index: 0 })]);
    renderWithClient(permit);
    // The Design tab is the only one rendered for an empty permit.
    expect(screen.queryByTestId('pd-v2-empty-cycle-hint-0')).toBeNull();
  });
});
