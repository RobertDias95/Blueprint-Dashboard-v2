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
//   Sub-issue 3 (fix-25-DD narrowed → fix-38 re-widened): viewCycleIdx
//     auto-advances to the NEWEST cycle whenever its index grows — both
//     c0 → c1 (intake snap) AND c_N → c_(N+1) (resubmitted snap). Safe
//     again because fix-25-DD's blur/Enter-only commit means the cycles
//     array only grows on a deliberate commit, never on raw calendar nav
//     (the original cluster-A explosion driver).
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

describe('PermitDetailV2 fix-35 Bug 3 — draft overlay snaps the highlight before commit', () => {
  // The chain-position highlight reads committed permit data, so pre-fix-35
  // it lagged until blur. The overlay treats the in-flight draft as the
  // field's value for highlight purposes only — no mutation until blur.
  // cycle 0 (design) + cycle 1 (review) so cycle 1 uses the REVIEW chain
  // (corr_issued is a candidate); a firstIdx cycle would use the design
  // chain and ignore corr_issued.
  function designPlusReview(): PermitWithCycles {
    return makePermit([
      makeCycle({ cycle_index: 0, intake_accepted: '2026-04-01' }),
      makeCycle({ cycle_index: 1, submitted: '2026-05-01' }),
    ]);
  }

  it('picking a date moves data-highlighted to that cell immediately, with no mutation', () => {
    renderWithClient(<PermitDetailV2 permit={designPlusReview()} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    const submittedCell = screen.getByTestId('pd-cell-cycle1-submitted');
    const corrCell = screen.getByTestId('pd-cell-cycle1-corr_issued');
    // Chain-position rule: submitted is the most-advanced populated cell.
    expect(submittedCell.getAttribute('data-highlighted')).toBe('true');
    expect(corrCell.getAttribute('data-highlighted')).toBe('false');

    const corrInput = corrCell.querySelector('input') as HTMLInputElement;
    fireEvent.change(corrInput, { target: { value: '2026-06-15' } });

    // Highlight snaps to corr_issued the instant the date is picked …
    expect(corrCell.getAttribute('data-highlighted')).toBe('true');
    expect(submittedCell.getAttribute('data-highlighted')).toBe('false');
    // … and the overlay is visual-only: no mutation, hence no snap RPC and
    // no cycle creation.
    expect(cycleMutateAsync).not.toHaveBeenCalled();
  });

  it('calendar-arrow spam keeps the highlight live but fires zero mutations; blur commits once', () => {
    renderWithClient(<PermitDetailV2 permit={designPlusReview()} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    const corrCell = screen.getByTestId('pd-cell-cycle1-corr_issued');
    const corrInput = corrCell.querySelector('input') as HTMLInputElement;
    // Walking the date picker back month-by-month — many onChange events.
    fireEvent.change(corrInput, { target: { value: '2026-08-15' } });
    fireEvent.change(corrInput, { target: { value: '2026-07-15' } });
    fireEvent.change(corrInput, { target: { value: '2026-06-15' } });
    expect(corrCell.getAttribute('data-highlighted')).toBe('true');
    expect(cycleMutateAsync).not.toHaveBeenCalled();

    fireEvent.blur(corrInput);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    expect(cycleMutateAsync.mock.calls[0][0].patch).toEqual({
      corr_issued: '2026-06-15',
    });
  });

  it('switching cycle tabs clears the overlay (highlight reverts to committed)', () => {
    const permit = designPlusReview();
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    const corrInput = screen
      .getByTestId('pd-cell-cycle1-corr_issued')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(corrInput, { target: { value: '2026-06-15' } });
    expect(
      screen.getByTestId('pd-cell-cycle1-corr_issued').getAttribute('data-highlighted'),
    ).toBe('true');

    // Switch away (to Design) and back — no blur fired (input was never
    // focused), so the view-change reset is what must clear the overlay.
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    // Committed corr_issued is still null → highlight is back on submitted.
    expect(
      screen.getByTestId('pd-cell-cycle1-corr_issued').getAttribute('data-highlighted'),
    ).toBe('false');
    expect(
      screen.getByTestId('pd-cell-cycle1-submitted').getAttribute('data-highlighted'),
    ).toBe('true');
    expect(cycleMutateAsync).not.toHaveBeenCalled();
  });
});

describe('PermitDetailV2 fix-38 — auto-advance follows the newest cycle on snap growth', () => {
  it('intake on c0 + blur → c1 created → view advances to c1 + c1 submitted highlighted', () => {
    // Permit starts with no review cycles → initial viewCycleIdx=0 (Design).
    const initial = makePermit([]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);
    expect(screen.getByTestId('pd-v2-date-strip-design')).toBeInTheDocument();

    // Commit intake_accepted on the design strip (blur — NOT on change).
    const intake = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(intake, { target: { value: '2026-05-07' } });
    fireEvent.blur(intake);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);

    // Server snap materializes c1; the cache grows from 0 → 1 review cycles.
    act(() => {
      hostRef.setPermit(
        makePermit([
          makeCycle({ cycle_index: 0, intake_accepted: '2026-05-07' }),
          makeCycle({ cycle_index: 1, submitted: '2026-05-07' }),
        ]),
      );
    });

    // View advanced to c1 and its submitted cell is the highlighted milestone.
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();
    expect(
      screen
        .getByTestId('pd-cell-cycle1-submitted')
        .getAttribute('data-highlighted'),
    ).toBe('true');
  });

  it('resubmitted on c1 + blur → c2 created → view advances to c2', () => {
    const initial = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
      }),
    ]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();

    const resub = screen
      .getByTestId('pd-cell-cycle1-resubmitted')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(resub, { target: { value: '2026-06-10' } });
    fireEvent.blur(resub);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);

    // c1.resubmitted → snap creates c2.
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

    // fix-38: the view now advances to c2 (fix-35 had pinned it on c1).
    expect(screen.getByTestId('pd-v2-date-strip-cycle-2')).toBeInTheDocument();
  });

  it('resubmitted on c2 + blur → c3 created → view advances to c3', () => {
    const initial = makePermit([
      makeCycle({ cycle_index: 1, submitted: '2026-05-01', resubmitted: '2026-06-10' }),
      makeCycle({ cycle_index: 2, submitted: '2026-06-10' }),
    ]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-2'));
    expect(screen.getByTestId('pd-v2-date-strip-cycle-2')).toBeInTheDocument();

    const resub = screen
      .getByTestId('pd-cell-cycle2-resubmitted')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(resub, { target: { value: '2026-07-10' } });
    fireEvent.blur(resub);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);

    act(() => {
      hostRef.setPermit(
        makePermit([
          makeCycle({ cycle_index: 1, submitted: '2026-05-01', resubmitted: '2026-06-10' }),
          makeCycle({
            cycle_index: 2,
            submitted: '2026-06-10',
            resubmitted: '2026-07-10',
          }),
          makeCycle({ cycle_index: 3, submitted: '2026-07-10' }),
        ]),
      );
    });

    expect(screen.getByTestId('pd-v2-date-strip-cycle-3')).toBeInTheDocument();
  });

  it('a permit mounting mid-stream (newest already c3) does not auto-advance', () => {
    // prevNewestIdxRef is initialised to the mounted newest (3), so the
    // first effect run sees no growth — and a non-growth refresh later must
    // not yank the view forward either. Only an INCREASE advances.
    const hostRef = makeHostRef();
    renderWithClient(
      <ControlledHost
        initial={makePermit([
          makeCycle({ cycle_index: 1, submitted: '2026-05-01', resubmitted: '2026-06-01' }),
          makeCycle({ cycle_index: 2, submitted: '2026-06-01', resubmitted: '2026-07-01' }),
          makeCycle({ cycle_index: 3, submitted: '2026-07-01' }),
        ])}
        hostRef={hostRef}
      />,
    );

    // Deliberately go back to c1.
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();

    // Non-growth refresh (newest still c3, a c1 field changed) — no advance.
    act(() => {
      hostRef.setPermit(
        makePermit([
          makeCycle({ cycle_index: 1, submitted: '2026-05-02', resubmitted: '2026-06-01' }),
          makeCycle({ cycle_index: 2, submitted: '2026-06-01', resubmitted: '2026-07-01' }),
          makeCycle({ cycle_index: 3, submitted: '2026-07-01' }),
        ]),
      );
    });
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();
  });

  // fix-75 explicitly inverts the cluster-A guarantee on snap-driving cells
  // (intake_accepted + resubmitted): Bobby wants the next cycle to materialize
  // as SOON as a valid date lands, not on blur. The trade is that walking the
  // date picker back month-by-month on these specific cells DOES fire a commit
  // per step. This test pins the new contract.
  it('fix-75: each calendar-arrow step on `resubmitted` fires a commit immediately (snap-on-input trade)', () => {
    const initial = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
      }),
    ]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));

    const resub = screen
      .getByTestId('pd-cell-cycle1-resubmitted')
      .querySelector('input') as HTMLInputElement;
    // Four month-step changes — each a valid YYYY-MM-DD → each commits.
    fireEvent.change(resub, { target: { value: '2026-09-10' } });
    fireEvent.change(resub, { target: { value: '2026-08-10' } });
    fireEvent.change(resub, { target: { value: '2026-07-10' } });
    fireEvent.change(resub, { target: { value: '2026-06-10' } });
    expect(cycleMutateAsync).toHaveBeenCalledTimes(4);
    expect(cycleMutateAsync.mock.calls[3][0]).toMatchObject({
      patch: { resubmitted: '2026-06-10' },
    });

    // Blur is the safety net; the latest valid value already committed, so
    // blur is a no-op (dedupe + commitOnChange guard).
    fireEvent.blur(resub);
    expect(cycleMutateAsync).toHaveBeenCalledTimes(4);

    // The server snap from the latest commit advances the view to c2.
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
    expect(screen.getByTestId('pd-v2-date-strip-cycle-2')).toBeInTheDocument();
  });
});

// fix-70 removed the D&E/Permitting task stage tabs (the task panel now groups
// by discipline, not phase), so the old "task category auto-switches to
// Permitting" describe block was deleted — the behavior it covered no longer
// exists. Cycle auto-advance (fix-38) is unaffected and still covered below.

describe('PermitDetailV2 fix-38 — sequential snaps advance to each new cycle', () => {
  it('three sequential snaps (c1→c2→c3→c4) advance the view to each newest cycle', () => {
    // Pre-fix-35 this fed the cluster-A explosion (advance → onChange writes
    // the new cycle → snap → repeat). That loop is closed by fix-25-DD's
    // blur/Enter-only commit: the array only grows on a deliberate commit,
    // never on raw calendar nav. So advancing to each newest cycle is safe.
    const initial = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2026-05-01',
        intake_accepted: '2026-05-07',
      }),
    ]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
    expect(screen.getByTestId('pd-v2-date-strip-cycle-1')).toBeInTheDocument();

    // c2 lands → advance.
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
    expect(screen.getByTestId('pd-v2-date-strip-cycle-2')).toBeInTheDocument();

    // c3 lands → advance.
    act(() => {
      hostRef.setPermit(
        makePermit([
          makeCycle({ cycle_index: 1, submitted: '2026-05-01', resubmitted: '2026-06-10' }),
          makeCycle({
            cycle_index: 2,
            submitted: '2026-06-10',
            resubmitted: '2026-07-10',
          }),
          makeCycle({ cycle_index: 3, submitted: '2026-07-10' }),
        ]),
      );
    });
    expect(screen.getByTestId('pd-v2-date-strip-cycle-3')).toBeInTheDocument();

    // c4 lands → advance.
    act(() => {
      hostRef.setPermit(
        makePermit([
          makeCycle({ cycle_index: 1, submitted: '2026-05-01', resubmitted: '2026-06-10' }),
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
    expect(screen.getByTestId('pd-v2-date-strip-cycle-4')).toBeInTheDocument();
  });
});
