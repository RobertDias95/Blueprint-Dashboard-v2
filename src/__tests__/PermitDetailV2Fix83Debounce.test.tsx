import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-83: DateCell's commit-on-change path is debounced 500ms. Bobby's 4903
// S Greenway BP — clicking the date-picker up-arrow 5-6 times to backscroll
// c0.intake_accepted spawned 6 phantom cycle 1 rows. Calendar-arrow nav fires
// a full valid YYYY-MM-DD onChange at every step; fix-75 then fired one snap
// RPC per step and the racy IF NOT EXISTS branch on the server INSERTed one
// row per call. The frontend debounce coalesces a burst of valid-date
// changes into one save with the LAST date; the backend ON CONFLICT rewrite
// (fix_83_cycle_snap_idempotency.sql) is the defense in depth.

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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fix-83: commit-on-change debounce coalesces calendar-arrow spam', () => {
  it('5 rapid onChange events fire EXACTLY ONE commit with the last date after 500ms', () => {
    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    const input = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;

    // Walk the date back month-by-month, like Bobby clicking the picker
    // up-arrow 5 times. Each step produces a full valid YYYY-MM-DD.
    const dates = [
      '2026-05-15',
      '2026-04-15',
      '2026-03-15',
      '2026-02-15',
      '2026-01-15',
    ];
    for (const d of dates) {
      fireEvent.change(input, { target: { value: d } });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    // 5 changes at 100ms each = 400ms elapsed; debounce window is 500ms so
    // nothing has fired yet.
    expect(cycleMutateAsync).not.toHaveBeenCalled();

    // Cross the 500ms boundary from the LAST change.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    expect(cycleMutateAsync.mock.calls[0][0]).toMatchObject({
      patch: { intake_accepted: '2026-01-15' },
    });
  });

  it('blur mid-debounce fires the commit immediately with the current draft', () => {
    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    const input = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-05-15' } });
    fireEvent.change(input, { target: { value: '2026-04-15' } });
    // 200ms in — debounce hasn't fired.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(cycleMutateAsync).not.toHaveBeenCalled();

    // User clicks away — blur flushes the pending commit NOW.
    fireEvent.blur(input);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    expect(cycleMutateAsync.mock.calls[0][0]).toMatchObject({
      patch: { intake_accepted: '2026-04-15' },
    });

    // Cross the original 500ms window — the cleared timer must not double-fire.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('after a rejected commit, blur retries immediately (lastCommitFailedRef path)', async () => {
    // First call rejects (mimics an OCC/RPC error); the second is the retry.
    cycleMutateAsync
      .mockRejectedValueOnce(new Error('OCC mismatch'))
      .mockResolvedValueOnce(undefined);

    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    const input = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-05-15' } });
    // Let the debounce fire AND the rejected promise settle so
    // lastCommitFailedRef flips to true.
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);

    // User blurs to retry. The blur path now sees no armed timer (it already
    // fired) and falls through to the lastCommitFailedRef branch → tryCommit
    // is called again with the same draft. tryCommit's dedupe is bypassed
    // because the earlier rejection restored lastCommittedRef to its prior
    // value, so 2026-05-15 != lastCommitted and the second mutateAsync fires.
    fireEvent.blur(input);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(2);
    expect(cycleMutateAsync.mock.calls[1][0]).toMatchObject({
      patch: { intake_accepted: '2026-05-15' },
    });
  });

  it('unmount during the debounce window fires no commit (timer cleanup)', () => {
    const { unmount } = renderWithClient(
      <PermitDetailV2 permit={makePermit()} />,
    );
    const input = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-05-15' } });
    // Halfway through the debounce window the user switches permits → the
    // cell unmounts. The useEffect cleanup must clear the timer so the
    // setTimeout callback never fires after the component is gone.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cycleMutateAsync).not.toHaveBeenCalled();
  });

  it('a single onChange after the debounce window fires exactly once', () => {
    // Sanity: one valid date → one commit. The debounce should be invisible
    // to the slow-typing case (typing the last digit and pausing).
    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    const input = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-05-15' } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    expect(cycleMutateAsync.mock.calls[0][0]).toMatchObject({
      patch: { intake_accepted: '2026-05-15' },
    });
  });

  // fix-119-b: pin the EXACT Bobby-reported scenario from the bug report —
  // 6 rapid arrow taps from June to January on c0.intake_accepted. fix-83's
  // 500ms debounce collapses this into one commit; fix-119-a's server WHERE
  // tightening guarantees a single cycle 1 row at the end. The test exists
  // both as a regression guard and as a worked example matching the brief.
  it('fix-119-b: 6 rapid calendar-arrow back-clicks fire EXACTLY ONE commit with the last (oldest) date', () => {
    renderWithClient(<PermitDetailV2 permit={makePermit()} />);
    const input = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;

    // June → May → April → March → February → January, one click per month.
    // The browser's type=date stepper emits a full valid YYYY-MM-DD on each
    // arrow tap; pre-fix-83 this fired one snap RPC per click.
    const dates = [
      '2026-06-15',
      '2026-05-15',
      '2026-04-15',
      '2026-03-15',
      '2026-02-15',
      '2026-01-15',
    ];
    for (const d of dates) {
      fireEvent.change(input, { target: { value: d } });
      // 80ms between clicks — Bobby's spam was reportedly even faster than this,
      // but anything under the 500ms debounce window suffices.
      act(() => {
        vi.advanceTimersByTime(80);
      });
    }
    // 6 changes × 80ms = 480ms elapsed; still inside the 500ms window so no
    // commit has fired.
    expect(cycleMutateAsync).not.toHaveBeenCalled();

    // Cross the 500ms boundary from the LAST change.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    // The save carries the last (oldest) date — Bobby's intended final value.
    expect(cycleMutateAsync.mock.calls[0][0]).toMatchObject({
      patch: { intake_accepted: '2026-01-15' },
    });
    // (Server-side, fix-119-a's ON CONFLICT … WHERE … IS DISTINCT FROM
    // EXCLUDED.submitted guarantees the resulting cycle 1.submitted ends up
    // at 2026-01-15 in a single row with a single updated_at advance.
    // Verified via MCP sandbox in the fix-119-a commit.)
  });
});
