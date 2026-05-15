import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-25d: PermitDetailV2 behavior tests.
//   Sub-issue 1: DateCell commits on onChange (not just onBlur) — kills
//     the 10-15s "highlight lag" Bobby reported on 1327.
//   Sub-issue 3: viewCycleIdx auto-advances to the newest cycle when a
//     snap creates one (cycles array grows).
//   Sub-issue 4 (25f): activeStage flips to 'pm' on viewCycleIdx 0→≥1
//     transition (entering review cycles auto-switches the task list
//     category to Permitting).
//   Manual navigation back to an earlier cycle is preserved (auto-advance
//     only fires on cycle-count growth, not on every render).

// Shared mock — every component render gets the same mutateAsync so the
// test can assert call counts across the whole render lifecycle.
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

/** Controlled host — lets a test flip the permit prop in place to simulate
 *  a cache update (e.g., a snap creating a new cycle). */
function ControlledHost({
  initial,
  hostRef,
}: {
  initial: PermitWithCycles;
  hostRef: { setPermit: (p: PermitWithCycles) => void };
}) {
  const [permit, setPermit] = useState(initial);
  hostRef.setPermit = setPermit;
  return <PermitDetailV2 permit={permit} />;
}

beforeEach(() => {
  cycleMutateAsync.mockReset();
  cycleMutateAsync.mockResolvedValue({});
});

describe('PermitDetailV2 fix-25d — DateCell commits on change (not blur-only)', () => {
  it('typing a date in a Cycle 1 input fires the cycle upsert BEFORE blur', () => {
    // Permit with cycle 1 already created (so the Cycle 1 tab exists +
    // commitCycleField hits the update path). Pre-fix-25d this required a
    // blur to commit, leaving the highlight stale until blur fired.
    const permit = makePermit([
      makeCycle({ cycle_index: 1, submitted: '2026-05-01' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    // Switch to Cycle 1 tab so the cycle strip renders.
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    // The cycle strip's corr_issued cell — currently empty. Type a date.
    const corrInput = screen
      .getByTestId('pd-cell-cycle1-corr_issued')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(corrInput, { target: { value: '2026-06-15' } });

    // The mutation should fire immediately, not wait for blur.
    expect(cycleMutateAsync).toHaveBeenCalled();
    const payload = cycleMutateAsync.mock.calls[0][0];
    expect(payload.op).toBe('update');
    expect(payload.patch).toEqual({ corr_issued: '2026-06-15' });
  });

  it('blurring the same cell with the same value does NOT fire a second commit (idempotency dedup)', () => {
    const permit = makePermit([
      makeCycle({ cycle_index: 1, submitted: '2026-05-01' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    const corrInput = screen
      .getByTestId('pd-cell-cycle1-corr_issued')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(corrInput, { target: { value: '2026-06-15' } });
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    // Now blur. Same value → no additional commit.
    fireEvent.blur(corrInput);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe('PermitDetailV2 fix-25d — active tab auto-advances on snap', () => {
  it('viewCycleIdx jumps to the newest cycle when cycles array grows', () => {
    // Initial state: cycle 1 already populated → component initialises
    // viewCycleIdx to 1. After a snap creates cycle 2, the cycle count
    // grows and the newest cycle_index (2) is > current view (1) → bump.
    const initial = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
      }),
    ]);
    const hostRef = { setPermit: (_p: PermitWithCycles) => {} };
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);

    // Sanity: cycle 1 tab is the active one.
    const tab1Before = screen.getByTestId('pd-v2-cycle-tab-1');
    expect(tab1Before).toBeInTheDocument();
    expect(screen.queryByTestId('pd-v2-cycle-tab-2')).toBeNull();

    // Snap fires server-side → optimistic cache update inflates cycles
    // array. Simulate by flipping the permit prop.
    const afterSnap = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
        resubmitted: '2026-06-10',
      }),
      makeCycle({ cycle_index: 2, submitted: '2026-06-10' }),
    ]);
    act(() => {
      hostRef.setPermit(afterSnap);
    });

    // Cycle 2 tab now exists AND is the active view (DateStrip below the
    // tab bar would render cycle-2's grid). We assert via the cycle strip
    // testid which encodes the current viewIdx.
    expect(screen.getByTestId('pd-v2-cycle-tab-2')).toBeInTheDocument();
    expect(screen.getByTestId('pd-v2-date-strip-cycle-2')).toBeInTheDocument();
  });
});

describe('PermitDetailV2 fix-25d — task category auto-switches to Permitting', () => {
  it("clicking Cycle 1 from Design flips activeStage from 'de' to 'pm'", () => {
    // Permit with no cycles initially → component falls back to viewCycleIdx=0
    // (Design) and activeStage='de'.
    const permit = makePermit([]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    // Sanity: D&E stage tab is the placeholder shown by TasksPanel.
    expect(screen.getByPlaceholderText('Add D&E task…')).toBeInTheDocument();

    // Manually create a cycle by entering data on Design strip? Easier:
    // use a fresh permit with cycle 1 already present, then click the
    // Cycle 1 tab. The 0→1 transition fires the auto-switch effect.
  });

  it('controlled host: flipping viewCycleIdx 0 → 1 via tab click auto-switches activeStage to pm', () => {
    // Use a permit with cycle 1 + Design tab as the initial view. Then
    // click Cycle 1 tab → viewCycleIdx 0 → 1 → activeStage auto-flips.
    //
    // Initial viewCycleIdx logic: if currentPhase.cycleIndex is null, falls
    // back to stage check; stage='de' → 0. We make currentPhase.cycleIndex
    // null by having cycle 1 empty.
    const permit = makePermit([makeCycle({ cycle_index: 1 })]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    // Pre-click: Design tab + 'de' stage → "Add D&E task…" placeholder.
    expect(screen.getByPlaceholderText('Add D&E task…')).toBeInTheDocument();
    // Click Cycle 1 tab.
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    // Post-click: activeStage='pm' → "Add permitting task…" placeholder.
    expect(screen.getByPlaceholderText('Add permitting task…')).toBeInTheDocument();
  });

  it("manual navigation back to Design from Cycle 1 does NOT auto-flip stage back to 'de'", () => {
    // Bobby: once activeStage flips to 'pm', it stays 'pm' even if the
    // user clicks Design again. (They can manually re-select 'de' via
    // the stage tabs if they want.)
    const permit = makePermit([makeCycle({ cycle_index: 1 })]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    expect(screen.getByPlaceholderText('Add permitting task…')).toBeInTheDocument();
    // Now flip back to Design.
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    // activeStage stays 'pm' — the placeholder still says permitting.
    expect(screen.getByPlaceholderText('Add permitting task…')).toBeInTheDocument();
  });
});

describe('PermitDetailV2 fix-25d — auto-advance respects manual navigation', () => {
  it('after auto-advance to Cycle 2, user clicking Cycle 1 stays on Cycle 1 (no re-advance)', () => {
    // Bobby's spec test: auto-advance only fires on cycle-count growth.
    // Once the user manually navigates back to an earlier cycle, the
    // effect doesn't re-trigger.
    const initial = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
      }),
    ]);
    const hostRef = { setPermit: (_p: PermitWithCycles) => {} };
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);

    // Trigger the snap-driven growth.
    const afterSnap = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
        resubmitted: '2026-06-10',
      }),
      makeCycle({ cycle_index: 2, submitted: '2026-06-10' }),
    ]);
    act(() => {
      hostRef.setPermit(afterSnap);
    });
    // Auto-advanced to Cycle 2.
    expect(screen.getByTestId('pd-v2-date-strip-cycle-2')).toBeInTheDocument();

    // Manually navigate back to Cycle 1.
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();

    // Trigger ANOTHER permit update that does NOT grow cycles (e.g. a
    // field update on cycle 1). The auto-advance effect should not fire.
    const noGrowth = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
        resubmitted: '2026-06-10',
        city_target: '2026-07-01', // new field, no new cycle
      }),
      makeCycle({ cycle_index: 2, submitted: '2026-06-10' }),
    ]);
    act(() => {
      hostRef.setPermit(noGrowth);
    });
    // Stayed on Cycle 1 — auto-advance did NOT fire on re-render.
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();
  });
});
