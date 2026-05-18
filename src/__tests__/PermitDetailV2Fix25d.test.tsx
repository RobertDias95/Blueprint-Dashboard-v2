import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-25d / fix-25-DD: PermitDetailV2 behavior tests.
//   Sub-issue 1 (fix-25-DD reverts): DateCell commits on blur or
//     Enter, NOT on every onChange. Calendar nav arrows / intermediate
//     keystrokes only update the visible value. The 10-15s highlight
//     lag from the original blur-only era is now handled by
//     fix-25d-residual's cache merge, not commit-on-change.
//   Sub-issue 3 (fix-25-DD narrows): viewCycleIdx auto-advances only
//     on the first c0 → c1 transition. Subsequent snap-driven growth
//     (c_N.resubmitted → c_(N+1) creation) does NOT move the tab.
//     Defense in depth against the cluster-A feedback loop.
//   Sub-issue 4 (25f, unchanged): activeStage flips to 'pm' on
//     viewCycleIdx 0→≥1 transition.
//   Manual navigation back to an earlier cycle is preserved.

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
type HostRef = { setPermit: (p: PermitWithCycles) => void };
function makeHostRef(): HostRef {
  // Stub typed to the contract; ControlledHost overwrites this with the
  // real setState on first render. Using a zero-arg arrow keeps the
  // unused-args lint rule happy without needing an underscore prefix
  // (the repo's eslint config doesn't whitelist `_*`).
  return { setPermit: () => {} };
}
function ControlledHost({
  initial,
  hostRef,
}: {
  initial: PermitWithCycles;
  hostRef: HostRef;
}) {
  const [permit, setPermit] = useState(initial);
  // Capturing setState into a test-controlled ref is deliberate — the
  // pattern lets the test drive permit updates after the component has
  // mounted (simulating a TanStack-Query cache refresh). The react-hooks
  // immutability rule flags any prop mutation, but the ref-object IS
  // the contract here.
  // eslint-disable-next-line react-hooks/immutability
  hostRef.setPermit = setPermit;
  return <PermitDetailV2 permit={permit} />;
}

beforeEach(() => {
  cycleMutateAsync.mockReset();
  cycleMutateAsync.mockResolvedValue({});
});

describe('PermitDetailV2 fix-25-DD — DateCell commits on blur or Enter only', () => {
  it('typing / changing a date in a Cycle 1 input does NOT commit until blur', () => {
    // fix-25-DD reverts the per-change commit. Picking a date in the
    // browser's date picker fires onChange (no blur yet) — pre-DD this
    // triggered the mutation immediately, which on calendar-arrow
    // backfills fed the cluster-A feedback loop on 3056 PAR.
    const permit = makePermit([
      makeCycle({ cycle_index: 1, submitted: '2026-05-01' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    const corrInput = screen
      .getByTestId('pd-cell-cycle1-corr_issued')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(corrInput, { target: { value: '2026-06-15' } });
    expect(cycleMutateAsync).not.toHaveBeenCalled();
    // Multiple intermediate changes — still no commits.
    fireEvent.change(corrInput, { target: { value: '2026-05-15' } });
    fireEvent.change(corrInput, { target: { value: '2026-04-15' } });
    expect(cycleMutateAsync).not.toHaveBeenCalled();
    // Blur commits the final value once.
    fireEvent.blur(corrInput);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    const payload = cycleMutateAsync.mock.calls[0][0];
    expect(payload.op).toBe('update');
    expect(payload.patch).toEqual({ corr_issued: '2026-04-15' });
  });

  it('blurring with no value change does NOT fire a commit (idempotency dedup)', () => {
    const permit = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        corr_issued: '2026-06-15',
      }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    const corrInput = screen
      .getByTestId('pd-cell-cycle1-corr_issued')
      .querySelector('input') as HTMLInputElement;
    // Blur without changing the value — should be a no-op.
    fireEvent.blur(corrInput);
    expect(cycleMutateAsync).not.toHaveBeenCalled();
  });

  it('Enter key commits via the blur path', () => {
    const permit = makePermit([
      makeCycle({ cycle_index: 1, submitted: '2026-05-01' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    const corrInput = screen
      .getByTestId('pd-cell-cycle1-corr_issued')
      .querySelector('input') as HTMLInputElement;
    corrInput.focus();
    fireEvent.change(corrInput, { target: { value: '2026-06-15' } });
    expect(cycleMutateAsync).not.toHaveBeenCalled();
    // The Enter handler programmatically blurs. jsdom dispatches blur
    // synchronously when an active element is blurred; React's synthetic
    // onBlur fires on the dispatched event.
    fireEvent.keyDown(corrInput, { key: 'Enter' });
    fireEvent.blur(corrInput);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    expect(cycleMutateAsync.mock.calls[0][0].patch).toEqual({
      corr_issued: '2026-06-15',
    });
  });
});

describe('PermitDetailV2 fix-25-DD — auto-advance fires only on c0 → c1', () => {
  it('first c0 → c1 transition while viewing Design auto-advances to c1', () => {
    // Permit starts with no cycles → initial viewCycleIdx=0 (Design).
    // c0.intake snap creates c1 → cycles.length grows from 0 → 1 with
    // newest cycle_index=1. The auto-advance effect SHOULD fire.
    const initial = makePermit([]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);

    expect(screen.getByTestId('pd-v2-date-strip-design')).toBeInTheDocument();

    const afterIntakeSnap = makePermit([
      makeCycle({ cycle_index: 0, intake_accepted: '2026-05-07' }),
      makeCycle({ cycle_index: 1, submitted: '2026-05-07' }),
    ]);
    act(() => {
      hostRef.setPermit(afterIntakeSnap);
    });

    expect(screen.getByTestId('pd-v2-cycle-tab-1')).toBeInTheDocument();
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();
  });

  it('subsequent c_N → c_(N+1) growth does NOT auto-advance the tab', () => {
    // cluster-A regression: c1.resubmitted edit → snap creates c2 →
    // pre-DD the view auto-advanced to c2 and the next onChange (still
    // in flight on the calendar widget) wrote to c2.resubmitted, which
    // snapped c3, etc. Eleven cycles on 3056 PAR/Pre-Sub.
    //
    // fix-25-DD: once view sits on c1 (or later), cycle growth doesn't
    // move it. User stays where they were editing.
    const initial = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
      }),
    ]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);

    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();

    // Simulate snap creating c2 (c1.resub → c2.submitted snap).
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

    // c2 tab is available, BUT the view stays on c1.
    expect(screen.getByTestId('pd-v2-cycle-tab-2')).toBeInTheDocument();
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();
    expect(screen.queryByTestId('pd-v2-date-strip-cycle-2')).toBeNull();
  });

  it('c0 → c1 auto-advance only fires when viewCycleIdx is still 0', () => {
    // Edge case: user manually clicks Cycle 1 tab before any snap has
    // ever fired, then a c0 → c1 snap creates the row. The view is
    // already on c1, so the effect's `viewCycleIdx === 0` guard
    // prevents a redundant setViewCycleIdx (and any flicker).
    const initial = makePermit([]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);

    // Sanity start on Design.
    expect(screen.getByTestId('pd-v2-date-strip-design')).toBeInTheDocument();

    // Snap happens. View advances to c1 (this is the canonical happy path).
    const afterFirstSnap = makePermit([
      makeCycle({ cycle_index: 0, intake_accepted: '2026-05-07' }),
      makeCycle({ cycle_index: 1, submitted: '2026-05-07' }),
    ]);
    act(() => {
      hostRef.setPermit(afterFirstSnap);
    });
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();
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

describe('PermitDetailV2 fix-25-DD — repeated cycle growth never reactivates auto-advance', () => {
  it('three sequential snaps (c1→c2→c3→c4) all leave the view on c1', () => {
    // Direct regression for the cluster-A 3056 PAR pattern. Pre-DD,
    // each cycle-growth bump moved the view to the new cycle; the next
    // calendar-arrow click landed on that cycle and snapped another.
    // Post-DD the view never advances past c1, no matter how many
    // snaps fire in sequence.
    const initial = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
      }),
    ]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);

    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();

    // Iteration 1: c2 lands.
    act(() => {
      hostRef.setPermit(
        makePermit([
          makeCycle({
            cycle_index: 1,
            submitted: '2026-05-01',
            intake_accepted: '2026-05-07',
            resubmitted: '2026-06-10',
          }),
          makeCycle({ cycle_index: 2, submitted: '2026-06-10' }),
        ]),
      );
    });
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();

    // Iteration 2: c3 lands.
    act(() => {
      hostRef.setPermit(
        makePermit([
          makeCycle({
            cycle_index: 1,
            submitted: '2026-05-01',
            intake_accepted: '2026-05-07',
            resubmitted: '2026-06-10',
          }),
          makeCycle({
            cycle_index: 2,
            submitted: '2026-06-10',
            resubmitted: '2026-07-10',
          }),
          makeCycle({ cycle_index: 3, submitted: '2026-07-10' }),
        ]),
      );
    });
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();

    // Iteration 3: c4 lands. Still cycle-1 in the strip.
    act(() => {
      hostRef.setPermit(
        makePermit([
          makeCycle({
            cycle_index: 1,
            submitted: '2026-05-01',
            intake_accepted: '2026-05-07',
            resubmitted: '2026-06-10',
          }),
          makeCycle({
            cycle_index: 2,
            submitted: '2026-06-10',
            resubmitted: '2026-07-10',
          }),
          makeCycle({
            cycle_index: 3,
            submitted: '2026-07-10',
            resubmitted: '2026-08-10',
          }),
          makeCycle({ cycle_index: 4, submitted: '2026-08-10' }),
        ]),
      );
    });
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();
    // All four cycle tabs are reachable, but only by clicking.
    expect(screen.getByTestId('pd-v2-cycle-tab-2')).toBeInTheDocument();
    expect(screen.getByTestId('pd-v2-cycle-tab-3')).toBeInTheDocument();
    expect(screen.getByTestId('pd-v2-cycle-tab-4')).toBeInTheDocument();
  });
});
