import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-97: cycle date editor input validation.
//   (A) min/max year guard: native date inputs accept year=0020/0002,
//       which fix-89's server check rejects but only after a round-trip.
//       The new input now carries min=2020-01-01 / max=2030-12-31 plus a
//       defense-in-depth tryCommit guard so out-of-range values never
//       reach bp_upsert_permit_cycle_row.
//   (B) chronology chain (submitted ≤ intake_accepted ≤ corr_issued ≤
//       resubmitted): reactive client-side check runs as the user edits.
//       Offending field paints red, an inline error mirroring the
//       server's RAISE EXCEPTION format surfaces, and tryCommit refuses
//       to fire the mutation. Empty fields short-circuit the pair check
//       so backfill in piecemeal order isn't blocked mid-entry.

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

describe('PermitDetailV2 fix-97 — cycle date input validation', () => {
  // ── Check A: year-range guard ─────────────────────────────────────
  describe('year-range guard', () => {
    it('every cycle date input carries min=2020-01-01 / max=2030-12-31', () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 0, submitted: '2026-03-01' }),
        makeCycle({ cycle_index: 1, submitted: '2026-04-01' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
      for (const testid of [
        'pd-cell-cycle1-submitted',
        'pd-cell-cycle1-city_target',
        'pd-cell-cycle1-corr_issued',
        'pd-cell-cycle1-resubmitted',
      ]) {
        const input = screen
          .getByTestId(testid)
          .querySelector('input') as HTMLInputElement;
        expect(input.getAttribute('min')).toBe('2020-01-01');
        expect(input.getAttribute('max')).toBe('2030-12-31');
      }
    });

    it('typing a year=0020 date paints red, surfaces "Year must be between" inline, and refuses to commit', async () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 0, submitted: '2026-03-01' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
      const intakeInput = screen
        .getByTestId('pd-cell-design-intake_accepted')
        .querySelector('input') as HTMLInputElement;
      fireEvent.change(intakeInput, { target: { value: '0020-04-09' } });
      // Inline error appears immediately (year guard runs on draft change).
      expect(
        screen.getByTestId('pd-cell-design-intake_accepted-error').textContent,
      ).toContain('Year must be between 2020 and 2030');
      expect(intakeInput.getAttribute('data-local-error')).toBe('true');
      // Blur attempts to commit; the year guard blocks the mutation.
      fireEvent.blur(intakeInput);
      await new Promise((r) => setTimeout(r, 0));
      expect(cycleMutateAsync).not.toHaveBeenCalled();
    });

    it('pasting a year=0002 date also gets blocked (no setUp-day grace)', async () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 0, submitted: '2026-01-13' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
      const intakeInput = screen
        .getByTestId('pd-cell-design-intake_accepted')
        .querySelector('input') as HTMLInputElement;
      // jsdom's <input type=date> accepts arbitrary year via direct value
      // assignment — same shape the browser autocomplete / paste would
      // produce when the OS locale tab-completes a partial year string.
      fireEvent.change(intakeInput, { target: { value: '0002-02-02' } });
      fireEvent.blur(intakeInput);
      await new Promise((r) => setTimeout(r, 0));
      expect(cycleMutateAsync).not.toHaveBeenCalled();
      expect(
        screen.getByTestId('pd-cell-design-intake_accepted-error').textContent,
      ).toContain('Year must be between');
    });

    it('a date inside the [2020, 2030] window commits normally', async () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 0, submitted: '2026-03-01' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
      const intakeInput = screen
        .getByTestId('pd-cell-design-intake_accepted')
        .querySelector('input') as HTMLInputElement;
      fireEvent.change(intakeInput, { target: { value: '2026-03-15' } });
      // commitOnChange path: the intake_accepted cell fires after a 500ms
      // debounce on a valid value (fix-83). Blur shortcuts the timer.
      fireEvent.blur(intakeInput);
      await new Promise((r) => setTimeout(r, 0));
      expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
      expect(cycleMutateAsync.mock.calls[0][0].patch).toEqual({
        intake_accepted: '2026-03-15',
      });
    });
  });

  // ── Check B: chronology chain ─────────────────────────────────────
  describe('chronology chain (reactive)', () => {
    it('typing intake_accepted < submitted paints red + inline error matches server format', () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 0, submitted: '2026-06-05' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
      const intakeInput = screen
        .getByTestId('pd-cell-design-intake_accepted')
        .querySelector('input') as HTMLInputElement;
      fireEvent.change(intakeInput, { target: { value: '2026-03-02' } });
      // The error text mirrors fix-89's RAISE EXCEPTION wording so the
      // user learns the same vocabulary regardless of which side of the
      // wire catches it.
      expect(
        screen.getByTestId('pd-cell-design-intake_accepted-error').textContent,
      ).toContain(
        'intake_accepted (2026-03-02) cannot precede submitted (2026-06-05)',
      );
      expect(intakeInput.getAttribute('data-local-error')).toBe('true');
    });

    it('chain violation blocks the mutation on blur (server never sees the bad value)', async () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 0, submitted: '2026-06-05' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
      const intakeInput = screen
        .getByTestId('pd-cell-design-intake_accepted')
        .querySelector('input') as HTMLInputElement;
      fireEvent.change(intakeInput, { target: { value: '2026-03-02' } });
      fireEvent.blur(intakeInput);
      await new Promise((r) => setTimeout(r, 0));
      expect(cycleMutateAsync).not.toHaveBeenCalled();
    });

    it('typing resubmitted < submitted on a review cycle paints red on the resubmitted cell', () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 1, submitted: '2026-04-09' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
      const resubInput = screen
        .getByTestId('pd-cell-cycle1-resubmitted')
        .querySelector('input') as HTMLInputElement;
      fireEvent.change(resubInput, { target: { value: '2026-04-06' } });
      expect(
        screen.getByTestId('pd-cell-cycle1-resubmitted-error').textContent,
      ).toContain(
        'resubmitted (2026-04-06) cannot precede submitted (2026-04-09)',
      );
    });

    it('a fully valid chain (submitted < corr_issued < resubmitted) shows no errors and commits clean', async () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 1, submitted: '2026-03-01' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
      const corrInput = screen
        .getByTestId('pd-cell-cycle1-corr_issued')
        .querySelector('input') as HTMLInputElement;
      fireEvent.change(corrInput, { target: { value: '2026-03-20' } });
      expect(
        screen.queryByTestId('pd-cell-cycle1-corr_issued-error'),
      ).toBeNull();
      fireEvent.blur(corrInput);
      await new Promise((r) => setTimeout(r, 0));
      expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
      expect(cycleMutateAsync.mock.calls[0][0].patch).toEqual({
        corr_issued: '2026-03-20',
      });
    });

    it('NULL fields in the chain do not block save (piecemeal entry)', async () => {
      // Bobby's backfill flow: he types submitted then leaves intake
      // blank and fills corr_issued. The (submitted, corr_issued) pair
      // is still chronologically valid; intake = null short-circuits
      // any pair it would participate in.
      const permit = makePermit([
        makeCycle({ cycle_index: 1, submitted: '2026-03-01' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
      const corrInput = screen
        .getByTestId('pd-cell-cycle1-corr_issued')
        .querySelector('input') as HTMLInputElement;
      fireEvent.change(corrInput, { target: { value: '2026-04-10' } });
      expect(
        screen.queryByTestId('pd-cell-cycle1-corr_issued-error'),
      ).toBeNull();
      fireEvent.blur(corrInput);
      await new Promise((r) => setTimeout(r, 0));
      expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
    });

    it('correcting the violation reactively clears the inline error', () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 1, submitted: '2026-03-01' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
      const resubInput = screen
        .getByTestId('pd-cell-cycle1-resubmitted')
        .querySelector('input') as HTMLInputElement;
      // Bad first.
      fireEvent.change(resubInput, { target: { value: '2026-02-15' } });
      expect(
        screen.getByTestId('pd-cell-cycle1-resubmitted-error'),
      ).toBeInTheDocument();
      // Corrected — error disappears live as the user types.
      fireEvent.change(resubInput, { target: { value: '2026-04-15' } });
      expect(
        screen.queryByTestId('pd-cell-cycle1-resubmitted-error'),
      ).toBeNull();
      expect(resubInput.getAttribute('data-local-error')).toBe('false');
    });
  });

  // ── Round-trip: existing mutation contract stays intact ──────────
  describe('round-trip', () => {
    it('a valid in-range, in-order date still reaches bp_upsert_permit_cycle_row unchanged', async () => {
      const permit = makePermit([
        makeCycle({ cycle_index: 1, submitted: '2026-03-01' }),
      ]);
      renderWithClient(<PermitDetailV2 permit={permit} />);
      fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-1'));
      const resubInput = screen
        .getByTestId('pd-cell-cycle1-resubmitted')
        .querySelector('input') as HTMLInputElement;
      fireEvent.change(resubInput, { target: { value: '2026-04-10' } });
      // resubmitted cell auto-commits via commitOnChange (fix-75) after
      // the 500ms debounce; blur shortcuts the timer to fire now.
      fireEvent.blur(resubInput);
      await new Promise((r) => setTimeout(r, 0));
      expect(cycleMutateAsync).toHaveBeenCalledTimes(1);
      const payload = cycleMutateAsync.mock.calls[0][0];
      expect(payload.op).toBe('update');
      expect(payload.patch).toEqual({ resubmitted: '2026-04-10' });
    });
  });
});
