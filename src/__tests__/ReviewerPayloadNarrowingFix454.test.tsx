import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  currentCycleIndex,
  latestCycleIndex,
  rowsForCycle,
  rollupCounts,
  reviewerVerdictForCycle,
  reviewerVerdictForLatestCycle,
} from '../lib/reviewerRollup';
import { buildProjectRows } from '../lib/projectViewHelpers';
import type { PermitCycleReviewer } from '../lib/database.types';

/**
 * ★★★ fix-454 §A (P-104) — THE FETCH GOT HALVED AND NOTHING ELSE MOVED.
 *
 * `useAllPermitCycleReviewers` now reads the view
 * `permit_cycle_reviewers_current` (each permit's LATEST cycle THAT HAS ROWS)
 * instead of the whole table. Measured on prod 2026-08-30: 2,597 rows / 919 kB
 * -> 1,293 rows / 456 kB, on the app's eight hottest screens and on every
 * realtime invalidation.
 *
 * ★★★ THIS IS NOT A PRUNE. The table keeps every historical row; the ticket
 * writes none. What changed is only what leaves the database.
 *
 * ★★★ AND THE VIEW IS "LATEST CYCLE THAT HAS ROWS", NOT "THE PERMIT'S CURRENT
 * CYCLE" — the distinction this whole suite exists to defend. fix-186 renders a
 * third state, "Cycle N — not yet assigned", when the current cycle has no
 * reviewer rows but an earlier one does, and BOTH sites detect it from the bare
 * existence of history:
 *
 *   ReviewerRollupChip.tsx:136   rows.length > 0
 *   projectViewHelpers.ts:180    awaitingCurrentCycle: rows.length > 0
 *
 * A strict current-cycle filter returns NOTHING for exactly those permits — 15
 * on prod — so the flag would flip to false and 15 live chips would silently
 * lose their explanation. Keeping the latest NON-EMPTY cycle keeps every
 * consumer's input byte-identical, which is why no consumer logic moved.
 *
 * ★★ IF SOMEONE LATER "TIDIES" THE VIEW TO max(permit_cycles.cycle_index),
 * `awaitingCurrentCycle survives` below is the test that fails.
 */

// ---------------------------------------------------------------------------
// The view's rule, mirrored in TS. There is no live database in CI (the SQL was
// verified against prod separately and the counts are in the PR body), so the
// selection rule is mirrored here and the equivalence is proved over it —
// the fix-153 pattern.
// ---------------------------------------------------------------------------
function viewRows(all: PermitCycleReviewer[]): PermitCycleReviewer[] {
  const keep = new Map<number, number>();
  for (const r of all) {
    const cur = keep.get(r.permit_id);
    if (cur === undefined || r.cycle_index > cur) keep.set(r.permit_id, r.cycle_index);
  }
  return all.filter((r) => r.cycle_index === keep.get(r.permit_id));
}

let nextId = 0;
function row(
  permitId: number,
  cycleIndex: number,
  status: PermitCycleReviewer['current_status'],
  name: string | null = `R${cycleIndex}`,
): PermitCycleReviewer {
  nextId += 1;
  return {
    id: `row-${nextId}`,
    permit_id: permitId,
    cycle_index: cycleIndex,
    reviewer_name: name,
    current_status: status,
    discipline: 'Structural',
  } as unknown as PermitCycleReviewer;
}

/** The three shapes that exist on prod, per the STEP 0 measurement. */
const PERMIT_WITH_HISTORY = 101; // 268 permits: current cycle has rows, older cycles too
const PERMIT_AWAITING = 202; //     15 permits: current cycle EMPTY, an earlier one has rows
const PERMIT_NEVER_HAD = 303; //    a permit with no reviewer rows at all

const ALL_ROWS: PermitCycleReviewer[] = [
  // 101 — cycles 1 and 2 are history, cycle 3 is live. 3 of its 8 rows survive.
  row(PERMIT_WITH_HISTORY, 1, 'corrections_required'),
  row(PERMIT_WITH_HISTORY, 1, 'approved'),
  row(PERMIT_WITH_HISTORY, 2, 'corrections_required'),
  row(PERMIT_WITH_HISTORY, 2, 'approved'),
  row(PERMIT_WITH_HISTORY, 2, 'not_required'),
  row(PERMIT_WITH_HISTORY, 3, 'in_review'),
  row(PERMIT_WITH_HISTORY, 3, 'approved'),
  row(PERMIT_WITH_HISTORY, 3, 'corrections_required'),
  // 202 — rows on cycle 1 only, but the permit has advanced to cycle 2.
  row(PERMIT_AWAITING, 1, 'corrections_required'),
  row(PERMIT_AWAITING, 1, 'approved'),
];

const CYCLES: Record<number, { cycle_index: number }[]> = {
  [PERMIT_WITH_HISTORY]: [{ cycle_index: 1 }, { cycle_index: 2 }, { cycle_index: 3 }],
  [PERMIT_AWAITING]: [{ cycle_index: 1 }, { cycle_index: 2 }],
  [PERMIT_NEVER_HAD]: [{ cycle_index: 1 }],
};

function forPermit(rows: PermitCycleReviewer[], id: number) {
  return rows.filter((r) => r.permit_id === id);
}

describe('fix-454 §A — the narrowed view is byte-identical to the table', () => {
  const narrowed = viewRows(ALL_ROWS);

  it('the view actually drops history (otherwise the suite proves nothing)', () => {
    expect(ALL_ROWS).toHaveLength(10);
    expect(narrowed).toHaveLength(5); // 3 live on 101, 2 latest-with-rows on 202
    expect(forPermit(narrowed, PERMIT_WITH_HISTORY).every((r) => r.cycle_index === 3)).toBe(true);
    expect(forPermit(narrowed, PERMIT_AWAITING).every((r) => r.cycle_index === 1)).toBe(true);
  });

  it.each([PERMIT_WITH_HISTORY, PERMIT_AWAITING, PERMIT_NEVER_HAD])(
    'permit %i: every fix-185 cycle computation is unchanged',
    (permitId) => {
      const before = forPermit(ALL_ROWS, permitId);
      const after = forPermit(narrowed, permitId);
      const cycles = CYCLES[permitId];

      // currentCycleIndex — including its cycles-empty fallback to the rows.
      expect(currentCycleIndex(cycles, after)).toBe(currentCycleIndex(cycles, before));
      expect(currentCycleIndex([], after)).toBe(currentCycleIndex([], before));

      // latestCycleIndex — the chip's legacy path when no cycles are supplied.
      expect(latestCycleIndex(after)).toBe(latestCycleIndex(before));

      const idx = currentCycleIndex(cycles, before);

      // The visible slice, and the counts computed from it.
      const visBefore = idx === null ? [] : rowsForCycle(before, idx);
      const visAfter = idx === null ? [] : rowsForCycle(after, idx);
      expect(visAfter.map((r) => r.id).sort()).toEqual(visBefore.map((r) => r.id).sort());
      expect(rollupCounts(visAfter, null, null)).toEqual(rollupCounts(visBefore, null, null));

      // The verdicts that drive the status pill and the dashboard bucket.
      expect(idx === null ? null : reviewerVerdictForCycle(after, idx)).toBe(
        idx === null ? null : reviewerVerdictForCycle(before, idx),
      );
      expect(reviewerVerdictForLatestCycle(after)).toBe(
        reviewerVerdictForLatestCycle(before),
      );

      // ★★★ The fix-186 bit. This is the one that a strict current-cycle filter
      //     would have broken, and it is a BOOLEAN over the whole permit — not
      //     over the visible slice.
      expect(after.length > 0).toBe(before.length > 0);
    },
  );

  it('★★★ awaitingCurrentCycle survives — the state a current-cycle filter kills', () => {
    const cycles = CYCLES[PERMIT_AWAITING];
    const before = forPermit(ALL_ROWS, PERMIT_AWAITING);
    const after = forPermit(narrowed, PERMIT_AWAITING);

    // The permit is on cycle 2; every reviewer row it owns is on cycle 1.
    expect(currentCycleIndex(cycles, after)).toBe(2);
    expect(rowsForCycle(after, 2)).toHaveLength(0);

    // …so the rollup is empty AND history exists — which is exactly the pair
    // that renders "Cycle 2 — not yet assigned" rather than a bare dash.
    expect(rollupCounts(rowsForCycle(after, 2), null, null).total).toBe(0);
    expect(after.length > 0).toBe(true);
    expect(after.length > 0).toBe(before.length > 0);

    // ★ And the counter-proof: had the view filtered to the CURRENT cycle, the
    //   permit would have contributed nothing and the flag would read false.
    const strictCurrentCycleFilter = before.filter((r) => r.cycle_index === 2);
    expect(strictCurrentCycleFilter.length > 0).toBe(false);
  });

  it('the fall-through still fires: no current-cycle rows means no verdict', () => {
    const after = forPermit(narrowed, PERMIT_AWAITING);
    // reviewerVerdictForCycle returns null for the current cycle, so the caller
    // drops to the cycle-date path — fix-185's documented behaviour, unchanged.
    expect(reviewerVerdictForCycle(after, 2)).toBeNull();
    // A permit that never had reviewers is null too, and the two are told apart
    // by rows.length, not by the verdict.
    expect(reviewerVerdictForCycle(forPermit(narrowed, PERMIT_NEVER_HAD), 1)).toBeNull();
  });

  it('Project View cells are identical, awaitingCurrentCycle included', () => {
    const projects = [
      { id: 'p1', address: '1 Main St', tenant_id: 't' },
    ] as unknown as Parameters<typeof buildProjectRows>[0];
    const permits = [
      {
        id: PERMIT_WITH_HISTORY,
        project_id: 'p1',
        type: 'Building Permit',
        status: 'Reviews In Process',
        permit_cycles: CYCLES[PERMIT_WITH_HISTORY],
      },
      {
        id: PERMIT_AWAITING,
        project_id: 'p1',
        type: 'Building Permit',
        status: 'Reviews In Process',
        permit_cycles: CYCLES[PERMIT_AWAITING],
      },
    ] as unknown as Parameters<typeof buildProjectRows>[1];

    const before = buildProjectRows(projects, permits, ALL_ROWS);
    const after = buildProjectRows(projects, permits, narrowed);

    expect(JSON.stringify(after)).toBe(JSON.stringify(before));

    // …and the awaiting permit really is carrying the flag, so the assertion
    // above is not passing on two identically-empty objects.
    const awaiting = after[0].permits.find((p) => p.permit.id === PERMIT_AWAITING);
    expect(awaiting?.reviewer.awaitingCurrentCycle).toBe(true);
    expect(awaiting?.reviewer.cycleIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The hook reads the view, and still pages.
// ---------------------------------------------------------------------------
const T = 'test-tenant-uuid';
const state = vi.hoisted(() => ({ total: 0, fromArgs: [] as string[] }));

vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.order = () => chain;
  chain.range = (from: number, to: number) => {
    const slice: { id: string; cycle_index: number }[] = [];
    for (let i = from; i <= to && i < state.total; i++) {
      slice.push({ id: `r-${i}`, cycle_index: 1 });
    }
    return Promise.resolve({ data: slice, error: null });
  };
  return {
    supabase: {
      from: (name: string) => {
        state.fromArgs.push(name);
        return chain;
      },
    },
  };
});

import {
  useAllPermitCycleReviewers,
  ALL_PERMIT_CYCLE_REVIEWERS_SOURCE,
} from '../hooks/useAllPermitCycleReviewers';

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  state.total = 0;
  state.fromArgs = [];
});

describe('fix-454 §A — the hook reads the view', () => {
  it('selects from permit_cycle_reviewers_current, never the raw table', async () => {
    state.total = 5;
    const { result } = renderHook(() => useAllPermitCycleReviewers(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.fromArgs.length).toBeGreaterThan(0);
    expect(new Set(state.fromArgs)).toEqual(new Set([ALL_PERMIT_CYCLE_REVIEWERS_SOURCE]));
    expect(ALL_PERMIT_CYCLE_REVIEWERS_SOURCE).toBe('permit_cycle_reviewers_current');
    // ★ Reading the table again would put 919 kB back on the wire.
    expect(state.fromArgs).not.toContain('permit_cycle_reviewers');
  });

  it('★ still pages — the narrowed set is 1,293 rows, over PostgREST’s cap', async () => {
    // fix-189's bug with a smaller margin is still a bug. 1,293 > 1,000.
    state.total = 1293;
    const { result } = renderHook(() => useAllPermitCycleReviewers(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1293);
  });
});
