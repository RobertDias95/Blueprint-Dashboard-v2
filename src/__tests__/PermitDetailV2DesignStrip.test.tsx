import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PermitWithCycles, PermitCycle } from '../lib/database.types';

// fix-24c: tests for the Design strip's firstCycle behaviour. Locks in
// Bug 2: cycle data must render in the "Initial Submit" / "Intake
// Accepted" cells regardless of the first surviving cycle's index, and
// the cells must stay in sync when the value prop updates after their
// initial mount (test 678 hit a "blank cells" symptom that was almost
// certainly DateCell's useState init-once swallowing the value when
// cycles arrived a tick after the parent's first render).

// All the mutation hooks PermitDetailV2 calls — stub them out so the
// component renders deterministically.
vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
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
// ScheduleEstimator pulls cross-tenant data via hooks — stub the whole
// thing so the test doesn't need to wire that supply chain.
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
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<>{node}</>, { wrapper });
}

beforeEach(() => {
  // Reset any cached state — the mocks above are pure stubs so nothing
  // else to clear here, but keep the hook for future expansion.
});

/** Click the "Design" cycle tab. PermitDetailV2's initial view defaults
 *  to the most-advanced populated cycle, so tests that want to assert
 *  what the Design strip renders need to switch tabs first. */
function clickDesignTab() {
  fireEvent.click(screen.getByTestId('pd-v2-cycle-tab-0'));
}

describe('<PermitDetailV2 /> Design strip — fix-24c firstCycle', () => {
  it('renders submitted + intake_accepted in the Design strip when cycle 1 has them (test 678 reproduction)', () => {
    const permit = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2025-11-15',
        intake_accepted: '2025-11-21',
      }),
      makeCycle({ cycle_index: 2 }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    clickDesignTab();
    const submittedInput = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    expect(submittedInput.value).toBe('2025-11-15');
    expect(intakeInput.value).toBe('2025-11-21');
  });

  it('renders the FIRST surviving cycle (by index) when cycle_index is non-contiguous — e.g. cycle 1 deleted, cycle 2 is now the anchor', () => {
    const permit = makePermit([
      makeCycle({
        cycle_index: 2,
        submitted: '2026-01-10',
        intake_accepted: '2026-01-15',
      }),
      makeCycle({ cycle_index: 3 }),
    ]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    clickDesignTab();
    const submittedInput = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    expect(submittedInput.value).toBe('2026-01-10');
    expect(intakeInput.value).toBe('2026-01-15');
  });

  it('Design cells stay empty when no cycles exist at all (no auto-render of stale data)', () => {
    const permit = makePermit([]);
    renderWithClient(<PermitDetailV2 permit={permit} />);
    // No cycles → initial view falls back to Design (stage='de'), so no
    // explicit tab click needed here.
    const submittedInput = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    expect(submittedInput.value).toBe('');
    expect(intakeInput.value).toBe('');
  });

  it('Design cell draft re-syncs when the value prop updates after first mount (fix-24c useEffect sync)', () => {
    // Controlled host so we can flip the permit prop in place without
    // remounting the QueryClientProvider. Mirrors what test 678 hit in
    // prod: cycles arrived a tick after PermitDetailV2 mounted, the
    // cells had already captured value='' in their useState init, and
    // never updated. The fix is a useEffect that syncs draft from value.
    let setNext: (p: PermitWithCycles) => void = () => {
      throw new Error('setNext not assigned');
    };
    function Host({ initial }: { initial: PermitWithCycles }) {
      const [permit, setPermit] = useState(initial);
      setNext = setPermit;
      return <PermitDetailV2 permit={permit} />;
    }
    const empty = makePermit([makeCycle({ cycle_index: 1 })]);
    renderWithClient(<Host initial={empty} />);
    // Empty cycle → currentPhase.cycleIndex is null → falls back to
    // Design tab. After the rerender with filled cycle, currentPhase
    // would normally bump to Cycle 1, but viewCycleIdx is initialised
    // ONCE — so the strip stays on Design. (That's intentional: it's
    // the same flow the user lives through when cycles arrive late.)
    let submittedInput = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;
    expect(submittedInput.value).toBe('');

    const filled = makePermit([
      makeCycle({
        cycle_index: 1,
        submitted: '2025-11-15',
        intake_accepted: '2025-11-21',
      }),
    ]);
    act(() => {
      setNext(filled);
    });
    submittedInput = screen
      .getByTestId('pd-cell-design-submitted')
      .querySelector('input') as HTMLInputElement;
    expect(submittedInput.value).toBe('2025-11-15');
    const intakeInput = screen
      .getByTestId('pd-cell-design-intake_accepted')
      .querySelector('input') as HTMLInputElement;
    expect(intakeInput.value).toBe('2025-11-21');
  });
});
