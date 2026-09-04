import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import type { LearnedEstimate } from '../lib/scheduleBenchmarks';
import type { PermitWithCycles } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-493 §B (P-152) — THE STEPPER SHOWS THE LIKELY CYCLE
// ===========================================================================
//
// On a shortcut estimate the projection's `targetCycle` is **1** — a code-path
// marker; that branch never walks cycles (fix-491). The stepper printed it
// directly above fix-491's own footnote saying *"…9 in 10 needed two or more
// correction rounds"*, so the widget contradicted itself in two adjacent lines.
//
// ★★ THE LEARNER IS MOCKED AND NOTHING ELSE IS. `computeLearnedSchedule` is
//    replaced so the cohort is a fixture; `computeProjectedApproval` runs FOR
//    REAL, so these assertions are about the wiring end to end — the route the
//    projection actually chose, and the number the widget actually drew.

const T = 'test-tenant-uuid';

const learnerRef = vi.hoisted(() => ({ current: null as LearnedEstimate | null }));

vi.mock('../lib/scheduleBenchmarks', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/scheduleBenchmarks')>();
  return { ...actual, computeLearnedSchedule: () => learnerRef.current };
});

const fixtures = vi.hoisted(() => ({
  permits: [] as unknown[],
  projects: [
    { id: 'p1', address: '554 N 75th St', juris: 'Seattle', archived: false },
  ],
}));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: fixtures.permits, isLoading: false, error: null }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: fixtures.projects, isLoading: false, error: null }),
}));
vi.mock('../hooks/useAllPermitCycleReviewers', () => ({
  useAllPermitCycleReviewers: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useAllProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/useUpdatePermit', () => ({
  useUpdatePermit: () => ({ mutate: vi.fn(), isPending: false }),
}));

import ScheduleEstimator from '../components/ProjectDetail/ScheduleEstimator';
import { SCHEDULE_DEFAULTS } from '../lib/scheduleBenchmarks';

function learner(over: Partial<LearnedEstimate> = {}): LearnedEstimate {
  return {
    source: 'Last 90d · Building Permit · Seattle',
    sampleCount: 30,
    dateRange: '',
    goToSubmit: null,
    avgIntakeToApproval: 160,
    cityReview1: SCHEDULE_DEFAULTS.cityReview1,
    corrResponse1: SCHEDULE_DEFAULTS.corrResponse1,
    cityReview2: SCHEDULE_DEFAULTS.cityReview2,
    corrResponse2: SCHEDULE_DEFAULTS.corrResponse2,
    cityReview3: SCHEDULE_DEFAULTS.cityReview3,
    corrResponse3: SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: SCHEDULE_DEFAULTS.cityReview4,
    corrResponse4: SCHEDULE_DEFAULTS.corrResponse4,
    cr1Count: 0, cr2Count: 0, cr3Count: 0, cr4Count: 0,
    co1Count: 0, co2Count: 0, co3Count: 0, co4Count: 0,
    avgCycles: 3,
    // ★ The real Seattle BP cohort, measured on prod 2026-09-04:
    //   n=30, 160 days, cycle 1 = 0 of 30, most likely = 3.
    mostLikelyCycle: 3,
    cycleDist: { 1: 0, 2: 4, 3: 19, 4: 7 },
    isAllTime: false,
    isCrossJuris: false,
    recencyTier: 'last_90d',
    ...over,
  };
}

/** ★ `554 N 75th St`'s shape: intake recorded, cycle 1 submitted, no
 *  corrections — the permit that takes the holistic shortcut. */
function permit(over: Record<string, unknown> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    num: '7139421-CN',
    target_submit: '2026-07-03',
    approval_date: null,
    actual_issue: null,
    extras: null,
    updated_at: '2026-09-01T00:00:00Z',
    permit_cycles: [
      { permit_id: 1, cycle_index: 0, intake_accepted: '2026-07-07' },
      { permit_id: 1, cycle_index: 1, submitted: '2026-06-25', city_target: '2026-09-15' },
    ],
    ...over,
  } as unknown as PermitWithCycles;
}

function renderIt(p: PermitWithCycles) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScheduleEstimator permit={p} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const stepper = () => screen.getByTestId('estimator-cycle-current');
const note = () => screen.getByTestId('estimator-source-note');

beforeEach(() => {
  learnerRef.current = learner();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

describe('fix-493 §B: the stepper on a shortcut estimate', () => {
  it('★★★ holistic_learned shows the LIKELY cycle (3), not the marker (1)', () => {
    renderIt(permit());
    expect(note().dataset.route).toBe('holistic_learned');
    // ★★★ THE DEFECT, INVERTED. `targetCycle` here is 1 and the stepper used
    //     to print it — one line above a sentence saying nine in ten permits
    //     need two or more correction rounds.
    expect(stepper().textContent).toBe('3');
  });

  it('★★★ …and the number does not contradict the sentence beside it', () => {
    // ★★ The two are read together, so they are asserted together. This is the
    //    whole complaint: the widget disagreed with itself in adjacent lines.
    renderIt(permit());
    expect(note().textContent).toContain('needed two or more correction rounds');
    expect(stepper().textContent).not.toBe('1');
  });

  it('★★ the control says what the number MEANS on this route', () => {
    renderIt(permit());
    expect(stepper().getAttribute('title')).toBe(
      'Likely approval cycle for this permit type — press to set your own',
    );
  });

  it('★★★ holistic_default keeps showing 1 — there is no likely cycle', () => {
    // ★★★ NO LEARNER, NO COHORT, NOTHING TO BE LIKELY ABOUT. Borrowing a
    //     number here would be the same defect wearing the other hat: the
    //     footnote already says the date is the per-type default.
    learnerRef.current = null;
    renderIt(permit({ permit_cycles: [] }));
    expect(note().dataset.route).toBe('holistic_default');
    expect(stepper().textContent).toBe('1');
    // ★ …and it keeps the plain label, not the "likely cycle" hint.
    expect(stepper().getAttribute('title')).toBe('Learner pick');
  });

  it('★★ a WALK route shows the cycle it actually walked to', () => {
    // ★ A permit with a correction round cannot take the shortcut, so
    //   `targetCycle` is a real walked target and is what the stepper means.
    renderIt(
      permit({
        permit_cycles: [
          { permit_id: 1, cycle_index: 0, intake_accepted: '2026-01-05' },
          {
            permit_id: 1,
            cycle_index: 1,
            submitted: '2026-01-01',
            corr_issued: '2026-02-01',
            resubmitted: '2026-02-10',
          },
          { permit_id: 1, cycle_index: 2, submitted: '2026-02-10' },
        ],
      }),
    );
    expect(note().dataset.route).toBe('walk_learned');
    expect(stepper().textContent).toBe('3');
    expect(stepper().getAttribute('title')).toBe('Learner pick');
  });

  it('★★★ an override wins on every route, and says it was set by hand', () => {
    renderIt(permit({ extras: { scheduleCycleOverride: 4 } }));
    expect(note().dataset.route).toBe('walk_override');
    expect(stepper().textContent).toBe('4');
    expect(stepper().getAttribute('title')).toBe(
      'Manual override — click ✕ to clear',
    );
  });

  it('★★★ §A END TO END: setting an override turns a shortcut into a walk', () => {
    // ★★★ THE BUG THE BRIEF CALLS "the hidden half". Same permit, same cohort;
    //     the only difference is the stored override. Before fix-493 BOTH of
    //     these rendered `holistic_learned` and a stepper reading 1 — the
    //     button was stored and ignored.
    const { unmount } = renderIt(permit());
    expect(note().dataset.route).toBe('holistic_learned');
    unmount();

    renderIt(permit({ extras: { scheduleCycleOverride: 3 } }));
    expect(note().dataset.route).toBe('walk_override');
    expect(note().textContent).toContain('Target set by hand to cycle 3');
  });
});
