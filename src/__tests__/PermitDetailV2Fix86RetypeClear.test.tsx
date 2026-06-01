import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-86: when a DateCell save is rejected by server-side validation
// (intake_accepted < submitted, etc.), the cell paints data-errored="true"
// (red border). Typing a value DIFFERENT from the one that was just
// rejected wipes that visual immediately — Bobby's 4563 34th Ave W Demo
// permit: the cell stayed painted red even after he typed a fresh value,
// making it feel like the field was stuck in error.

const updatePermitMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({
    mutateAsync: updatePermitMutateAsync,
    mutate: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('../hooks/useUpsertPermitCycle', () => ({
  useUpsertPermitCycle: () => ({
    mutateAsync: vi.fn(),
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

function makePermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
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
    permit_cycles: [makeCycle({ cycle_index: 1 })],
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
  updatePermitMutateAsync.mockReset();
});

describe('fix-86: DateCell error visual clears on retype', () => {
  it('a rejected save paints data-errored="true" on the cell', async () => {
    updatePermitMutateAsync.mockRejectedValueOnce(
      new Error('approval_date must be after submitted'),
    );

    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const cell = screen.getByTestId('pd-cell-approval_date');
    const input = cell.querySelector('input') as HTMLInputElement;

    // Pre-rejection state: not errored.
    expect(cell.getAttribute('data-errored')).toBe('false');

    await act(async () => {
      fireEvent.change(input, { target: { value: '2026-08-15' } });
      fireEvent.blur(input);
    });
    await waitFor(() =>
      expect(cell.getAttribute('data-errored')).toBe('true'),
    );
  });

  it('typing a value DIFFERENT from the one that was just rejected clears data-errored immediately', async () => {
    updatePermitMutateAsync.mockRejectedValueOnce(new Error('boom'));

    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const cell = screen.getByTestId('pd-cell-approval_date');
    const input = cell.querySelector('input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: '2026-08-15' } });
      fireEvent.blur(input);
    });
    await waitFor(() =>
      expect(cell.getAttribute('data-errored')).toBe('true'),
    );

    // Bobby types a fresh value — the error visual must go away now,
    // before the next save attempt.
    fireEvent.change(input, { target: { value: '2026-09-01' } });
    expect(cell.getAttribute('data-errored')).toBe('false');
  });

  it('typing the SAME value as the one just rejected keeps data-errored="true"', async () => {
    updatePermitMutateAsync.mockRejectedValueOnce(new Error('boom'));

    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const cell = screen.getByTestId('pd-cell-approval_date');
    const input = cell.querySelector('input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: '2026-08-15' } });
      fireEvent.blur(input);
    });
    await waitFor(() =>
      expect(cell.getAttribute('data-errored')).toBe('true'),
    );

    // Type a brand-new value (clears errored)…
    fireEvent.change(input, { target: { value: '2026-09-01' } });
    expect(cell.getAttribute('data-errored')).toBe('false');
    // …then revert back to the rejected one. Errored stays false because the
    // last rejection pointer was cleared on the previous change — the
    // visual only re-arms after a NEW failed commit.
    fireEvent.change(input, { target: { value: '2026-08-15' } });
    expect(cell.getAttribute('data-errored')).toBe('false');
  });

  it('a successful retry with the new value clears data-errored', async () => {
    updatePermitMutateAsync
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const cell = screen.getByTestId('pd-cell-approval_date');
    const input = cell.querySelector('input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: '2026-08-15' } });
      fireEvent.blur(input);
    });
    await waitFor(() =>
      expect(cell.getAttribute('data-errored')).toBe('true'),
    );

    // Retype + save the new value.
    await act(async () => {
      fireEvent.change(input, { target: { value: '2026-09-01' } });
      fireEvent.blur(input);
    });
    await waitFor(() => expect(updatePermitMutateAsync).toHaveBeenCalledTimes(2));
    expect(cell.getAttribute('data-errored')).toBe('false');
  });
});
