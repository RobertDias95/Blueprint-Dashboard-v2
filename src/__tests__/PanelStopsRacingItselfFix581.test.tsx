import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { isOCCConflict, type OCCConflictError } from '../lib/occ';
import { mutationErrorContext } from '../lib/mutationErrorContext';
import type { DaTimeBlock } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-581 (P-283 — CLOSED) — THE PANEL STOPS RACING ITSELF
// ===========================================================================
//
// Four weeks, five people, four proposed mechanisms all killed by measurement.
// fix-579 shipped the instrument instead of a fifth guess, and three
// post-instrumentation occurrences settled it on 2026-09-16 at 16:23 UTC:
//
//   733  Miles  np_…e7y0  expected 16:23:12.950  actual 16:23:14.187  Δ 1,237ms
//   734  Miles  np_…e7y0  expected 16:23:14.187  actual 16:23:16.898  Δ 2,711ms
//   735  Dave   np_…cvxq  expected 16:23:39.377  actual 16:23:44.833  Δ 5,456ms
//
// ★★ 734's `expected` IS 733's `actual`.
// ★★★ 735's `expected` IS THAT BLOCK'S `created_at`, to the microsecond — and
//     `np_1789575822373_cvxq` is four weeks wide on prod today, so what moved
//     its stamp was a RESIZE while the popup held a snapshot from creation.
//
// ---------------------------------------------------------------------------
// ★★★ WHERE THE TOKEN WAS SEEDED, AND WHY fix-442 DID NOT ALREADY FIX IT
// ---------------------------------------------------------------------------
//
// fix-442 made the CACHE correct at the moment a write returns. It did not make
// anything read from it. Every token the app posts for a time block is copied
// out at the moment an interaction STARTS:
//
//   npPopup.block.updated_at             the edit popup + its Remove button
//   pendingNpWarning.expectedUpdatedAt   the overlap prompt
//   pendingOverlap.expectedUpdatedAt     the force prompt
//   c.expectedUpdatedAt                  each listed conflict
//
// **A `setQueryData` correction cannot reach a value already copied into React
// state.** fix-442 fixed the writing half; this is the reading half.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const mocks = vi.hoisted(() => {
  const rpcFn = vi.fn();
  return {
    rpcFn,
    supabase: {
      rpc: (name: string, args: Record<string, unknown>) => rpcFn(name, args),
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.supabase }));

import { useUpsertDaTimeBlock } from '../hooks/useUpsertDaTimeBlock';
import { useResizeDaTimeBlock } from '../hooks/useResizeDaTimeBlock';
import { useDeleteDaTimeBlock } from '../hooks/useDeleteDaTimeBlock';
import { currentBlockToken } from '../lib/daTimeBlockCache';

const T = 'test-tenant-uuid';
const ID = 'np_1789575822373_cvxq';
const CREATED = '2026-09-16T16:23:39.377115+00:00';
const AFTER_1 = '2026-09-16T16:23:41.100000+00:00';
const AFTER_2 = '2026-09-16T16:23:44.833073+00:00';

function block(over: Partial<DaTimeBlock> = {}): DaTimeBlock {
  return {
    id: ID,
    da_name: 'Ahmadi',
    type: 'PTO',
    label: 'PTO',
    start_week: '2026-10-26',
    end_week: '2026-10-26',
    created_at: CREATED,
    updated_at: CREATED,
    project_id: null,
    ...over,
  } as DaTimeBlock;
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}
function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** The RPC's success shape for bp_upsert_da_time_block_row. */
const okUpsert = (updated_at: string) => ({
  data: [{ out_id: ID, updated_at, conflict: false }],
  error: null,
});
/** …and its refusal, carrying the row's REAL stamp (fix-579's `v_actual`). */
const conflictUpsert = (actual: string | null) => ({
  data: [{ out_id: ID, updated_at: actual, conflict: true }],
  error: null,
});

/** Every `p_expected_updated_at` posted, in order. */
function postedTokens(): unknown[] {
  return mocks.rpcFn.mock.calls.map(
    (c) => (c[1] as Record<string, unknown>).p_expected_updated_at,
  );
}

beforeEach(() => {
  mocks.rpcFn.mockReset();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ---------------------------------------------------------------------------
// §A1 · THE HELPER
// ---------------------------------------------------------------------------

describe('fix-581 §A — the token comes from the cache, not from the snapshot', () => {
  it('★★★ it returns the cached stamp, ignoring the stale one the caller holds', () => {
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block({ updated_at: AFTER_2 })]);
    // ★ CREATED is exactly what prod report 735 posted: the snapshot the popup
    //   captured when the block was made.
    expect(currentBlockToken(qc, T, ID, CREATED)).toBe(AFTER_2);
  });

  it('★★ an uncached list falls back to what the caller holds', () => {
    // A fresh tab that writes before it reads still has to send something, and
    // the snapshot is the best it knows. Never staler than today's behaviour.
    const qc = newClient();
    expect(currentBlockToken(qc, T, ID, CREATED)).toBe(CREATED);
  });

  it('★★ a block absent from the cached list falls back too', () => {
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block({ id: 'np_other' })]);
    expect(currentBlockToken(qc, T, ID, CREATED)).toBe(CREATED);
  });
});

// ---------------------------------------------------------------------------
// §A2 · THE BURST — the whole point of the ticket
// ---------------------------------------------------------------------------

describe('fix-581 §A — three rapid commits from one panel all succeed', () => {
  it('★★★ each write posts the stamp the PREVIOUS one returned', async () => {
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block()]);
    const { result } = renderHook(() => useUpsertDaTimeBlock(), {
      wrapper: wrapperFor(qc),
    });

    // ★★★ THE SNAPSHOT IS DELIBERATELY REUSED, unchanged, on all three calls —
    //     that is exactly what `npPopup.block` does, and before this ticket all
    //     three posted CREATED and the second and third were refused.
    const snapshot = block();

    mocks.rpcFn.mockResolvedValueOnce(okUpsert(AFTER_1));
    mocks.rpcFn.mockResolvedValueOnce(okUpsert(AFTER_2));
    mocks.rpcFn.mockResolvedValueOnce(okUpsert('2026-09-16T16:23:50.000000+00:00'));

    for (const patch of [
      { type: 'Corrections' },
      { label: 'Ahmadi — corrections' },
      { project_id: 'p-1' },
    ]) {
      await act(async () => {
        await result.current.mutateAsync({ op: 'update', block: snapshot, patch });
      });
    }

    // ★★★ THE ASSERTION IS THE TOKENS, NOT THE ABSENCE OF A TOAST. Three
    //     distinct stamps, each one the previous response's — the panel
    //     advancing instead of repeating itself.
    expect(postedTokens()).toEqual([CREATED, AFTER_1, AFTER_2]);
    expect(mocks.rpcFn).toHaveBeenCalledTimes(3);
  });

  it('★★★ a RESIZE advances the token the popup will post — prod 735', async () => {
    // ★★★ THE CASE A PER-COMPONENT REF COULD NOT HAVE FIXED. Dave's popup held
    //     `created_at` while a resize moved the stamp. Two different writers,
    //     one row, and only a shared cache sees both.
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block()]);

    const resize = renderHook(() => useResizeDaTimeBlock(), {
      wrapper: wrapperFor(qc),
    });
    mocks.rpcFn.mockResolvedValueOnce({
      data: [
        {
          out_id: ID,
          out_updated_at: AFTER_2,
          out_conflict: false,
          out_overlap_kind: null,
          out_overlap_conflicts: null,
          out_proposed_start_week: null,
          out_proposed_end_week: null,
        },
      ],
      error: null,
    });
    await act(async () => {
      await resize.result.current.mutateAsync({
        blockId: ID,
        newStartWeek: '2026-10-26',
        newEndWeek: '2026-11-16',
        expectedUpdatedAt: CREATED,
      });
    });

    // …now the popup saves, still holding its creation-time snapshot.
    const upsert = renderHook(() => useUpsertDaTimeBlock(), {
      wrapper: wrapperFor(qc),
    });
    mocks.rpcFn.mockResolvedValueOnce(okUpsert('2026-09-16T16:23:52.000000+00:00'));
    await act(async () => {
      await upsert.result.current.mutateAsync({
        op: 'update',
        block: block(),
        patch: { type: 'Corrections' },
      });
    });

    expect(postedTokens()).toEqual([CREATED, AFTER_2]);
  });

  it('★★ a DELETE reads it too — the Remove button holds the same snapshot', async () => {
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block({ updated_at: AFTER_2 })]);
    const { result } = renderHook(() => useDeleteDaTimeBlock(), {
      wrapper: wrapperFor(qc),
    });
    mocks.rpcFn.mockResolvedValue({
      data: [{ conflict: false }],
      error: null,
    });
    await act(async () => {
      await result.current.mutateAsync({ id: ID, updated_at: CREATED });
    });
    expect(postedTokens()).toEqual([AFTER_2]);
  });
});

// ---------------------------------------------------------------------------
// §B · A REAL CONFLICT MUST STILL BE REFUSED
// ---------------------------------------------------------------------------
//
// ⚠️⚠️ THE WHOLE VALUE OF OCC IS THAT TWO PEOPLE EDITING ONE BLOCK COLLIDE.
//       Advancing the token on your OWN successful save must never become
//       "send whatever the server last said" — that would delete the guard
//       while making the symptom disappear, which is the failure this Brain has
//       recorded four times.
//
// ★★★ WHAT MAKES IT SAFE: the cache is THIS CLIENT'S view. It advances only on
//     writes this client made and refetches it has actually received. A second
//     person's write is not in it until this client refetches — so their stamp
//     is invisible here and the collision still happens.

describe('fix-581 §B — the other direction: a genuine two-client conflict', () => {
  it('★★★ a second client holding an older token is STILL refused', async () => {
    const qc = newClient();
    // This client's cache holds what IT last saw. Somebody else has since
    // written the row — the server's stamp has moved and this client has not
    // refetched, so nothing here knows about it.
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block({ updated_at: AFTER_1 })]);
    const { result } = renderHook(() => useUpsertDaTimeBlock(), {
      wrapper: wrapperFor(qc),
    });
    mocks.rpcFn.mockResolvedValueOnce(conflictUpsert(AFTER_2));

    let err: unknown;
    await act(async () => {
      await result.current
        .mutateAsync({ op: 'update', block: block(), patch: { type: 'PTO' } })
        .catch((e) => {
          err = e;
        });
    });

    expect(isOCCConflict(err)).toBe(true);
    // ★ It posted its own freshest view — and was correctly refused, because
    //   that view is one write behind the server.
    expect(postedTokens()).toEqual([AFTER_1]);
  });

  it('★★★ …and the refusal still carries fix-579\'s instrument', async () => {
    // ⚠️ The next occurrence must still be diagnosable. A fix that silenced the
    //    instrument would leave the NEXT P-283 with nothing to read.
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block({ updated_at: AFTER_1 })]);
    const { result } = renderHook(() => useUpsertDaTimeBlock(), {
      wrapper: wrapperFor(qc),
    });
    mocks.rpcFn.mockResolvedValueOnce(conflictUpsert(AFTER_2));

    let err: unknown;
    await act(async () => {
      await result.current
        .mutateAsync({ op: 'update', block: block(), patch: { type: 'PTO' } })
        .catch((e) => {
          err = e;
        });
    });

    const detail = (err as OCCConflictError).detail;
    expect(detail?.rowId).toBe(ID);
    // ★★★ AND `expected` IS WHAT WAS POSTED, NOT WHAT THE CALLER HELD. Those
    //     are different values now, and a report naming the snapshot would send
    //     the next reader back to the popup for a bug that is not there.
    expect(detail?.expected).toBe(AFTER_1);
    expect(detail?.actual).toBe(AFTER_2);

    const ctx = mutationErrorContext(
      undefined,
      { write: 'bp_upsert_da_time_block_row' },
      { patch: { type: 'PTO' } },
      err,
    );
    expect(ctx?.occExpected).toBe(AFTER_1);
    expect(ctx?.occActual).toBe(AFTER_2);
    expect(ctx?.occConflict).toBe('stale-token');
    expect(typeof ctx?.occDeltaMs).toBe('number');
  });

  it('★★ a DELETED row still reports `row-missing`, not a stale token', async () => {
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block({ updated_at: AFTER_1 })]);
    const { result } = renderHook(() => useUpsertDaTimeBlock(), {
      wrapper: wrapperFor(qc),
    });
    mocks.rpcFn.mockResolvedValueOnce(conflictUpsert(null));
    let err: unknown;
    await act(async () => {
      await result.current
        .mutateAsync({ op: 'update', block: block(), patch: { type: 'PTO' } })
        .catch((e) => {
          err = e;
        });
    });
    const ctx = mutationErrorContext(
      undefined,
      { write: 'bp_upsert_da_time_block_row' },
      { patch: { type: 'PTO' } },
      err,
    );
    expect(ctx?.occConflict).toBe('row-missing');
  });
});

// ---------------------------------------------------------------------------
// §A3 · THE GUARD DID NOT MOVE
// ---------------------------------------------------------------------------

describe('fix-581 §A — this is a client fix', () => {
  it('★★★ every da_time_blocks writer reads the token from the cache', () => {
    // ★ Enumerated rather than listed by hand — fix-511 §B's lesson: a test that
    //   names three files is how a fourth writer gets in.
    for (const f of [
      'src/hooks/useUpsertDaTimeBlock.ts',
      'src/hooks/useResizeDaTimeBlock.ts',
      'src/hooks/useDeleteDaTimeBlock.ts',
    ]) {
      expect(strip(read(f)), f).toContain('currentBlockToken(');
    }
  });

  it('★★★ no migration — the RPC is untouched', () => {
    // ⚠️ The function is behaving correctly; it is being told the wrong thing.
    //    fix-442's ruling, kept: the guard is right about the row and wrong
    //    about the cause, and the fix for that class is never to widen it.
    const upsert = strip(read('src/hooks/useUpsertDaTimeBlock.ts'));
    expect(upsert).toContain('bp_upsert_da_time_block_row');
    expect(upsert).not.toContain('p_force');
  });

  it('★★ fix-580\'s empty-token branch was NOT copied here', () => {
    // ⚠️ DIFFERENT FAILURES. fix-580: the client sent `''`, PostgREST refused
    //    the cast, a 400 before the function ran. fix-581: the client sends a
    //    real, correct-looking timestamp one write out of date, the function
    //    runs and returns `conflict: true`. A row re-read would be answering
    //    the wrong question — and would defeat §B by fetching past the guard.
    const upsert = strip(read('src/hooks/useUpsertDaTimeBlock.ts'));
    expect(upsert).not.toMatch(/\.from\(['"]da_time_blocks['"]\)/);
    // occToken stays — fix-580's boundary rule still applies to the value.
    expect(upsert).toContain('occToken(');
  });
});

// ---------------------------------------------------------------------------
// §C · THE INTAKE PATH — MEASURED, AND IT DOES NOT SHARE THE DEFECT
// ---------------------------------------------------------------------------
//
// Report 729 (2026-09-15, Briana) was *"Intake changed since you loaded it"* on
// the same page, `fields: ["is_placeholder"]` — a different fingerprint and a
// different table, filed under P-283 while P-283 was believed to be about time
// blocks.
//
// ★★★ TWO MEASUREMENTS, AND THEY AGREE:
//
//   1. THE CODE. `IntakeTracker` passes the row LIVE —
//      `onPatch={(r, patch) => upsert.mutate({ op: 'update', record: r, patch })}`
//      where `r` comes from the rendered list, which re-renders off the same
//      cache `useUpsertIntakeRecord` writes back to (fix-258). **There is no
//      React-state snapshot anywhere on that path**, so a held token cannot go
//      stale — which is the whole of the time-block defect.
//
//   2. PROD. `error_reports` holds exactly ONE intake refusal, ever: 729. It
//      predates fix-579's instrument and carries no `occExpected` / `occActual`,
//      so its cause is not measurable from the data that exists — and **zero
//      have occurred since the instrument shipped**, against three time-block
//      refusals in the same window.
//
// ⚠️ SO IT IS LEFT ALONE, and that is a decision rather than an omission.
//    Changing a path whose one occurrence cannot be diagnosed would be the
//    fifth guess this ticket exists to stop making.

describe('fix-581 §C — the intake path is live-read, not snapshotted', () => {
  it('★★★ the row reaches the mutation from the render, not from state', () => {
    const src = strip(read('src/components/IntakeTracker.tsx'));
    expect(src).toMatch(
      /onPatch=\{\(r, patch\) =>\s*upsert\.mutate\(\{ op: 'update', record: r, patch \}\)/,
    );
    // ★ No captured record anywhere near the write — the two `useState`s on this
    //   page hold a selection id and a filter, never a row.
    expect(src).not.toMatch(/useState<IntakeRecord/);
  });

  it('★★ …and it already writes the fresh token back (fix-258)', () => {
    const src = strip(read('src/hooks/useUpsertIntakeRecord.ts'));
    expect(src).toMatch(/setQueryData<IntakeRecord\[\]>/);
  });
});
