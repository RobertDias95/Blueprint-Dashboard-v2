import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-75: intake_accepted (on the design strip) and resubmitted (on each cycle
// strip) drive a server-side snap that creates the next cycle. The previous
// blur-only commit meant Bobby's typed date sat there until he clicked away.
// These cells now auto-commit AS SOON AS the input contains a valid YYYY-MM-DD
// (the strict shape gate keeps calendar-arrow mid-nav from re-firing, per
// fix-25-DD). Other cells (submitted / corr_issued / approval / actual_issue)
// keep the blur/Enter-only commit.

const cycleMutateAsync = vi.hoisted(() => vi.fn());

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
  useDeletePermitCycle: () => ({ mutate: vi.fn(), isPending: false }),
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

function makePermit(
  cycles: PermitCycle[] = [makeCycle({ cycle_index: 0 })],
  over: Partial<PermitWithCycles> = {},
): PermitWithCycles {
  return {
    id: 10009,
    project_id: 'p-test',
    type: 'Building Permit',
    stage: 'de',
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
  cycleMutateAsync.mockReset();
  cycleMutateAsync.mockResolvedValue(undefined);
});

describe('fix-75: intake_accepted + resubmitted auto-snap on valid input', () => {
  // fix-83 update: the auto-commit path is now debounced 500ms (calendar-arrow
  // spam was spawning phantom cycles). These fix-75 cases fire blur after the
  // valid change to flush the pending debounced commit immediately — blur is
  // the explicit "commit now" signal even mid-debounce.
  it('intake_accepted fires the upsert on a valid date (flushed via blur)', () => {
    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    const input = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-05-15' } });
    fireEvent.blur(input);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    expect(cycleMutateAsync.mock.calls[0][0]).toMatchObject({
      patch: { intake_accepted: '2026-05-15' },
    });
  });

  it('resubmitted fires the upsert on a valid date (flushed via blur)', () => {
    // Cycle 1 needs to exist + be the viewed cycle for the Resubmitted cell to
    // render. With stage='pm', the component lands on the latest cycle (1).
    const permit = makePermit(
      [makeCycle({ cycle_index: 0 }), makeCycle({ cycle_index: 1 })],
      { stage: 'pm' },
    );
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const input = screen
      .getByTestId('pd-cell-cycle1-resubmitted')
      .querySelector('input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-06-01' } });
    fireEvent.blur(input);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    expect(cycleMutateAsync.mock.calls[0][0]).toMatchObject({
      patch: { resubmitted: '2026-06-01' },
    });
  });

  it('partial input does NOT fire the upsert (strict YYYY-MM-DD gate)', () => {
    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    const input = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;

    // Intermediate keystrokes — type=date won't produce these for real, but
    // pasted partials are a reasonable safety case the gate must reject.
    fireEvent.change(input, { target: { value: '2026' } });
    fireEvent.change(input, { target: { value: '2026-05' } });
    fireEvent.change(input, { target: { value: '2026-05-1' } });
    expect(cycleMutateAsync).not.toHaveBeenCalled();

    // The full valid date arms the debounce; blur flushes.
    fireEvent.change(input, { target: { value: '2026-05-15' } });
    fireEvent.blur(input);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('a non-snap cell (Submitted) still waits for blur/Enter — calendar-nav safety preserved', () => {
    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    const input = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-04-01' } });
    // No commit yet — only blur or Enter commits Submitted (fix-25-DD).
    expect(cycleMutateAsync).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
  });
});
