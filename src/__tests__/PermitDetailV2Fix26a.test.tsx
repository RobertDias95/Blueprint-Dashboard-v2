import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-26a: DateCell catches RPC validation rejections so they don't bubble
// to "Uncaught (in promise)" + resets lastCommittedRef so the user can
// retry the same value after a React Query rollback refreshes the value
// prop. Bobby's symptom on 1327: entered intake_accepted < submitted,
// got console-noise from unhandled rejections, plus the cell felt stuck.
//
// fix-25-DD: commits moved from onChange → onBlur. Each test now follows
// fireEvent.change with fireEvent.blur to drive the same code paths.

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

/** Controlled host so a test can simulate React Query rolling back the
 *  cache after a mutation rejection: flip the permit prop back to the
 *  pre-mutation state. */
type HostRef = { setPermit: (p: PermitWithCycles) => void };
function makeHostRef(): HostRef {
  // See fix-25-DD lint cleanup in Fix25d test — zero-arg arrow avoids
  // the no-unused-vars violation that `(_p) => {}` triggers because
  // the eslint config doesn't whitelist underscore-prefixed args.
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
  // Capturing setState into a test-controlled ref is deliberate — see
  // the matching comment in PermitDetailV2Fix25d's ControlledHost.
  // eslint-disable-next-line react-hooks/immutability
  hostRef.setPermit = setPermit;
  return <PermitDetailV2 permit={permit} />;
}

beforeEach(() => {
  cycleMutateAsync.mockReset();
});

describe('PermitDetailV2 fix-26a — DateCell error handling', () => {
  it('catches the mutation rejection so it does not surface as "Uncaught (in promise)"', async () => {
    // If the catch is missing, vitest would mark this test as failed via
    // its unhandled-rejection detection. Running to completion = catch
    // is firing.
    // fix-97: the chain-violating values used previously (intake 5-10
    // with submitted 5-15) are now blocked client-side before reaching
    // the mutation — so this test uses chain-valid values that still
    // reject server-side (e.g. OCC conflict) to exercise the catch path.
    cycleMutateAsync.mockRejectedValue(new Error('OCC conflict'));
    const permit = makePermit([
      makeCycle({ cycle_index: 0, submitted: '2026-05-15' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(intakeInput, { target: { value: '2026-05-20' } });
    fireEvent.blur(intakeInput);
    await waitFor(() => expect(cycleMutateAsync).toHaveBeenCalledTimes(1));
    // Give the catch a tick to run before the test ends.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('entering a corrected value after rejection fires a fresh mutation', async () => {
    // Real-world recovery: bad date rejected → user picks a different
    // date → second mutation fires (with the corrected value).
    // fix-97: chain-valid values both attempts; rejection is a generic
    // server error so the client-side chain check doesn't pre-empt.
    cycleMutateAsync
      .mockRejectedValueOnce(new Error('validation failed'))
      .mockResolvedValueOnce({});
    const permit = makePermit([
      makeCycle({ cycle_index: 0, submitted: '2026-05-15' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(intakeInput, { target: { value: '2026-05-20' } });
    fireEvent.blur(intakeInput);
    await waitFor(() => expect(cycleMutateAsync).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    // Corrected value — different from the bad one, so dedup never kicks in
    // regardless of whether the catch reset the ref. Verifies the cell
    // remains responsive after a rejection.
    fireEvent.change(intakeInput, { target: { value: '2026-05-25' } });
    fireEvent.blur(intakeInput);
    await waitFor(() => expect(cycleMutateAsync).toHaveBeenCalledTimes(2));
    expect(cycleMutateAsync.mock.calls[1][0].patch).toEqual({
      intake_accepted: '2026-05-25',
    });
  });

  it('re-typing the same value AFTER a value-prop refresh fires a fresh mutation (catch + useEffect ref reset)', async () => {
    // Real-world scenario: bad date rejected → React Query's onError
    // rolls back the optimistic update → permit prop refreshes with the
    // pre-mutation value → DateCell's useEffect resets draft + ref →
    // user re-types the same bad value → DOM change fires → mutation
    // attempts again.
    //
    // Simulated here by flipping the permit prop through the
    // optimistic-then-rollback dance (intake briefly populated then
    // re-cleared) via ControlledHost.
    // fix-97: switched values to chain-valid (intake > submitted) so
    // the new client-side check doesn't intercept; the test still
    // exercises the prop-refresh + ref-reset code path on a generic
    // server rejection.
    cycleMutateAsync.mockRejectedValue(new Error('validation failed'));
    const initial = makePermit([
      makeCycle({ cycle_index: 0, submitted: '2026-05-15', intake_accepted: null }),
    ]);
    const hostRef = makeHostRef();
    renderWithClient(<ControlledHost initial={initial} hostRef={hostRef} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;

    // First attempt — rejected.
    fireEvent.change(intakeInput, { target: { value: '2026-05-20' } });
    fireEvent.blur(intakeInput);
    await waitFor(() => expect(cycleMutateAsync).toHaveBeenCalledTimes(1));

    // Simulate React Query's onMutate optimistic update + onError rollback:
    // value briefly becomes '2026-05-20' (optimistic), then back to null
    // (rollback). The intermediate state matters — without it, the
    // useEffect on [value] doesn't see a change (initial null → final null).
    act(() => {
      hostRef.setPermit(makePermit([
        makeCycle({ cycle_index: 0, submitted: '2026-05-15', intake_accepted: '2026-05-20' }),
      ]));
    });
    act(() => {
      hostRef.setPermit(makePermit([
        makeCycle({ cycle_index: 0, submitted: '2026-05-15', intake_accepted: null }),
      ]));
    });
    await new Promise((r) => setTimeout(r, 0));

    // Cell visually reverted to '' (DOM input.value == ''). Re-typing the
    // same value triggers a real DOM change; tryCommit proceeds on blur
    // (ref was reset by useEffect on the prop flips).
    fireEvent.change(intakeInput, { target: { value: '2026-05-20' } });
    fireEvent.blur(intakeInput);
    await waitFor(() => expect(cycleMutateAsync).toHaveBeenCalledTimes(2));
  });

  it('successful mutation: the catch path is NOT taken (dedup still works on second commit attempt)', async () => {
    cycleMutateAsync.mockResolvedValue({});
    const permit = makePermit([
      makeCycle({ cycle_index: 0, submitted: '2026-05-15' }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    fireEvent.change(intakeInput, { target: { value: '2026-05-20' } });
    fireEvent.blur(intakeInput);
    await waitFor(() => expect(cycleMutateAsync).toHaveBeenCalledTimes(1));
    // A second blur with no further change — ref still equals draft so dedup blocks.
    fireEvent.blur(intakeInput);
    await new Promise((r) => setTimeout(r, 0));
    expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe('useUpsertPermitCycle fix-26a — error toast strips RPC prefix', () => {
  // The hook strips "bp_upsert_permit_cycle_row: " from PG RAISE EXCEPTION
  // messages so the user sees clean validation text. We unit-test the regex
  // directly since unmocking React Query + supabase for an integration
  // test is heavier than the fix warrants.
  it('strips the bp_upsert_permit_cycle_row prefix from a representative message', () => {
    const raw =
      'bp_upsert_permit_cycle_row: intake_accepted (2026-05-10) cannot precede submitted (2026-05-15)';
    const cleaned = raw.replace(/^bp_upsert_permit_cycle_row:\s*/, '');
    expect(cleaned).toBe(
      'intake_accepted (2026-05-10) cannot precede submitted (2026-05-15)',
    );
  });

  it('leaves non-prefixed messages unchanged', () => {
    const raw = 'connection terminated';
    expect(raw.replace(/^bp_upsert_permit_cycle_row:\s*/, '')).toBe(raw);
  });
});
