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

// fix-73: an OCC-driven refetch refreshes the permit prop while the user has
// unsaved typing in a DateCell. The cell's value-prop-sync effect used to
// blow away the typed value, forcing Bobby to re-enter it on the retry. The
// dirty flag now gates the sync so a typed-but-not-committed draft survives
// the rejection + the prop refresh.

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
    // 'pm' (permitting) lands viewCycleIdx on the latest cycle (cycle 1 here),
    // which is where the approval_date DateCell renders.
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

describe('fix-73: PermitDetailV2 DateCell OCC preservation', () => {
  it('next save sends the latest permit.updated_at after a prop refresh (T0 → T1)', async () => {
    updatePermitMutateAsync.mockResolvedValue(undefined);
    const T0 = '2026-05-14T12:00:00Z';
    const T1 = '2026-05-14T13:00:00Z';

    const permit0 = makePermit({ updated_at: T0 });
    const { rerender } = renderWithClient(<PermitDetailV2 permit={permit0} />);

    // Commit a value at T0 → mutateAsync receives T0.
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const input0 = screen
      .getByTestId('pd-cell-approval_date')
      .querySelector('input')!;
    await act(async () => {
      fireEvent.change(input0, { target: { value: '2026-08-15' } });
      fireEvent.blur(input0);
    });
    await waitFor(() => expect(updatePermitMutateAsync).toHaveBeenCalled());
    expect(updatePermitMutateAsync.mock.calls[0][0]).toMatchObject({
      expectedUpdatedAt: T0,
    });

    // Now the parent re-renders with a refreshed permit (T1). Commit again →
    // the inline read of permit.updated_at picks up T1.
    updatePermitMutateAsync.mockClear();
    const permit1 = makePermit({ updated_at: T1, approval_date: '2026-08-15' });
    rerender(<PermitDetailV2 permit={permit1} />);
    const input1 = screen
      .getByTestId('pd-cell-approval_date')
      .querySelector('input')!;
    await act(async () => {
      fireEvent.change(input1, { target: { value: '2026-09-01' } });
      fireEvent.blur(input1);
    });
    await waitFor(() => expect(updatePermitMutateAsync).toHaveBeenCalled());
    expect(updatePermitMutateAsync.mock.calls[0][0]).toMatchObject({
      expectedUpdatedAt: T1,
    });
  });

  it('typed approval_date is preserved across an OCC reject + prop refresh', async () => {
    // First commit rejects with an OCC-style error.
    updatePermitMutateAsync.mockRejectedValueOnce(
      new Error('this permit was updated elsewhere'),
    );
    const T0 = '2026-05-14T12:00:00Z';

    const permit = makePermit({ updated_at: T0, approval_date: null });
    const { rerender } = renderWithClient(<PermitDetailV2 permit={permit} />);

    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const input = screen
      .getByTestId('pd-cell-approval_date')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-08-15' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updatePermitMutateAsync).toHaveBeenCalled());

    // The refetch lands — parent re-renders with the SAME permit prop
    // (server's authoritative state shows approval_date still null since the
    // save was rolled back, but updated_at may bump on a sibling-driven event).
    rerender(
      <PermitDetailV2
        permit={makePermit({ updated_at: '2026-05-14T13:00:00Z', approval_date: null })}
      />,
    );

    // The user's typed value MUST stay in the input so they can simply blur
    // again (or hit Enter) to retry — no re-typing.
    const inputAfter = screen
      .getByTestId('pd-cell-approval_date')
      .querySelector('input') as HTMLInputElement;
    expect(inputAfter.value).toBe('2026-08-15');
  });

  it('happy path: a successful commit clears dirty so a later prop refresh syncs cleanly', async () => {
    updatePermitMutateAsync.mockResolvedValue(undefined);
    const T0 = '2026-05-14T12:00:00Z';

    const permit = makePermit({ updated_at: T0, approval_date: null });
    const { rerender } = renderWithClient(<PermitDetailV2 permit={permit} />);

    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const input = screen
      .getByTestId('pd-cell-approval_date')
      .querySelector('input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '2026-08-15' } });
      fireEvent.blur(input);
    });
    await waitFor(() => expect(updatePermitMutateAsync).toHaveBeenCalled());

    // After a SUCCESS the dirty flag clears. The parent now refreshes with
    // the server's authoritative value (a different date, e.g. an admin set
    // a different one in the same moment); the cell should reflect it.
    rerender(
      <PermitDetailV2
        permit={makePermit({
          updated_at: '2026-05-14T13:00:00Z',
          approval_date: '2026-12-01',
        })}
      />,
    );
    const inputAfter = screen
      .getByTestId('pd-cell-approval_date')
      .querySelector('input') as HTMLInputElement;
    expect(inputAfter.value).toBe('2026-12-01');
  });

  // fix-76: when the user types but the save hasn't (yet) succeeded, the cell
  // exposes data-dirty="true" so the visual marker (amber border + "•" beside
  // the label) tells Bobby the value he sees isn't saved. The attribute clears
  // on a successful commit, and stays set on an OCC reject so the retry
  // workflow still telegraphs the unsaved state.
  it('the cell carries data-dirty="true" while typed but uncommitted; clears on a successful commit', async () => {
    updatePermitMutateAsync.mockResolvedValue(undefined);
    const T0 = '2026-05-14T12:00:00Z';
    const { rerender } = renderWithClient(
      <PermitDetailV2 permit={makePermit({ updated_at: T0, approval_date: null })} />,
    );
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const cell = screen.getByTestId('pd-cell-approval_date');
    expect(cell.getAttribute('data-dirty')).toBe('false');

    const input = cell.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-08-15' } });
    // The typed but uncommitted draft marks the cell dirty.
    expect(cell.getAttribute('data-dirty')).toBe('true');

    // Commit succeeds → on the next render the cell is no longer dirty.
    await act(async () => {
      fireEvent.blur(input);
    });
    rerender(
      <PermitDetailV2
        permit={makePermit({
          updated_at: '2026-05-14T13:00:00Z',
          approval_date: '2026-08-15',
        })}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('pd-cell-approval_date').getAttribute('data-dirty'),
      ).toBe('false'),
    );
  });

  it('data-dirty stays "true" across an OCC reject so the retry telegraphs the unsaved value', async () => {
    updatePermitMutateAsync.mockRejectedValueOnce(
      new Error('this permit was updated elsewhere'),
    );
    const T0 = '2026-05-14T12:00:00Z';
    const { rerender } = renderWithClient(
      <PermitDetailV2 permit={makePermit({ updated_at: T0, approval_date: null })} />,
    );
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    const input = screen
      .getByTestId('pd-cell-approval_date')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-08-15' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updatePermitMutateAsync).toHaveBeenCalled());

    rerender(
      <PermitDetailV2
        permit={makePermit({ updated_at: '2026-05-14T13:00:00Z', approval_date: null })}
      />,
    );
    expect(
      screen.getByTestId('pd-cell-approval_date').getAttribute('data-dirty'),
    ).toBe('true');
  });
});
