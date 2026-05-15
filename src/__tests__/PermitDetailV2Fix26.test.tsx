import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-26: Design strip reads/writes cycle_index = 0 per Bobby's V1 model.
// Cycle 0 is the design slot; cycle 1+ are review cycles. Legacy permits
// where cycle 0 lacks design fields fall back to displaying cycle 1 (the
// pre-fix-26 location); writes always target cycle 0 (lazy-create when
// absent).

const cycleMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
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

function makeCycle(over: Partial<PermitCycle> & Pick<PermitCycle, 'cycle_index'>): PermitCycle {
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
  cycleMutateAsync.mockResolvedValue({});
});

describe('PermitDetailV2 fix-26 — Design strip reads from cycle 0', () => {
  it('post-migration permit: cycle 0 has design fields → Design strip renders them', () => {
    const permit = makePermit([
      makeCycle({
        cycle_index: 0,
        submitted: '2025-11-15',
        intake_accepted: '2025-11-21',
      }),
      makeCycle({ cycle_index: 1, submitted: '2025-11-21' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    // Force Design tab so we don't get auto-routed to a review cycle.
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    const submittedInput = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    expect(submittedInput.value).toBe('2025-11-15');
    expect(intakeInput.value).toBe('2025-11-21');
  });

  it('legacy fallback: cycle 0 empty + cycle 1 has design-shape data → Design strip displays cycle 1', () => {
    // Mirrors the pre-fix-26 data shape: wizard created cycle 0 (empty),
    // user entered Initial Submit/Intake Accepted, frontend wrote those
    // to cycle 1. Until the data migration moves them to cycle 0, the
    // Design strip falls back to displaying cycle 1.
    const permit = makePermit([
      makeCycle({ cycle_index: 0 }),
      makeCycle({
        cycle_index: 1,
        submitted: '2025-11-15',
        intake_accepted: '2025-11-21',
      }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    const submittedInput = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    expect(submittedInput.value).toBe('2025-11-15');
    expect(intakeInput.value).toBe('2025-11-21');
  });

  it('legacy fallback: no cycle 0 row at all + cycle 1 has design-shape → fallback fires', () => {
    const permit = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2025-11-15',
        intake_accepted: '2025-11-21',
      }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    const submittedInput = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;
    expect(submittedInput.value).toBe('2025-11-15');
  });

  it('Design strip Initial Submit write targets cycle 0 (update path when cycle 0 exists)', () => {
    const permit = makePermit([
      makeCycle({
        cycle_index: 0,
        id: 'c-0-id',
        submitted: '2025-11-15',
      }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    const submittedInput = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(submittedInput, { target: { value: '2026-01-15' } });
    expect(cycleMutateAsync).toHaveBeenCalled();
    const payload = cycleMutateAsync.mock.calls[0][0];
    expect(payload.op).toBe('update');
    expect(payload.cycle.cycle_index).toBe(0);
    expect(payload.patch).toEqual({ submitted: '2026-01-15' });
  });

  it('Design strip Initial Submit write lazy-creates cycle 0 when missing', () => {
    // Legacy permit with no cycle 0. First Design-strip edit should insert
    // cycle 0 (cycleIndex: 0), not cycle 1.
    const permit = makePermit([
      makeCycle({ cycle_index: 1, submitted: '2025-11-15' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(intakeInput, { target: { value: '2025-11-21' } });
    expect(cycleMutateAsync).toHaveBeenCalled();
    const payload = cycleMutateAsync.mock.calls[0][0];
    expect(payload.op).toBe('insert');
    expect(payload.cycleIndex).toBe(0);
    expect(payload.patch).toEqual({ intake_accepted: '2025-11-21' });
  });

  it('post-migration: cycle 1 has only submitted (snap value) → renders correctly in Cycle 1 tab', () => {
    const permit = makePermit([
      makeCycle({
        cycle_index: 0,
        submitted: '2025-11-15',
        intake_accepted: '2025-11-21',
      }),
      makeCycle({ cycle_index: 1, submitted: '2025-11-21' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    // viewCycleIdx defaults to cycle 1 here (most-populated cycle).
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();
    const submittedInput = screen
      .getByTestId('pd-cell-cycle1-submitted')
      .querySelector('input') as HTMLInputElement;
    expect(submittedInput.value).toBe('2025-11-21');
  });
});
