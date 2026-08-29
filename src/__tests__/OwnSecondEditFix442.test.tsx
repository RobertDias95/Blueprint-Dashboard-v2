import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { queryKeys } from '../lib/queryKeys';
import type { DaTimeBlock } from '../lib/database.types';

// ===========================================================================
// fix-442 (P-067) — "Time block changed since you loaded it" ON YOUR OWN EDIT
// ===========================================================================
//
// MEASURED ON PROD 2026-08-29, before anything was written. `error_reports`
// holds exactly SIX rows matching "changed since you loaded" and ALL SIX say
// "Time block" — none say "Draw schedule" or "Permit". So this is the
// `da_time_blocks` path, not the project-block one P-067's title blamed.
//
// Three users, all on /draw-schedule, and every one of the six sits 1.5–2.5 s
// after a SUCCESSFUL update of a block INSERTED 3–10 s earlier. 08-27,
// np_1787865797361_i85z: created 21:23:17.4 · updated 21:23:21.3 (one
// successful write) · error 21:23:23.1. One person, one block, add → edit →
// edit again, alone in the app. Nobody else touched anything.
//
// ★★★ THE MECHANISM, REPRODUCED HERE BEFORE IT WAS FIXED. The three
// `da_time_blocks` writers only INVALIDATE the list after a write; none writes
// the returned `updated_at` back into the cache. Between the write landing and
// the refetch arriving, the grid still renders the PRE-write row, so the resize
// handles and the popup hand the server a token it has already superseded —
// and `bp_resize_da_time_block`'s `v_current_updated_at IS DISTINCT FROM
// p_expected_updated_at` is quite correct to refuse it.
//
// ★★ fix-73 / fix-341's class exactly: the guard is right about the row and
//    wrong about the cause. So the guard does not move — the cache learns.

const T = 'test-tenant-uuid';
const ID = 'np_1787865797361_i85z';

const mocks = vi.hoisted(() => {
  const rpcFn = vi.fn();
  /** Server-side truth: one row, whose updated_at advances on every write. */
  const server = { updatedAt: 'T0', conflicts: [] as string[] };
  const builder = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      const expected = args.p_expected_updated_at as string | null;

      if (name === 'bp_resize_da_time_block') {
        if (expected !== server.updatedAt) {
          server.conflicts.push(String(expected));
          return Promise.resolve({
            data: [{ out_id: ID, out_updated_at: null, out_conflict: true,
                     out_overlap_kind: null, out_overlap_conflicts: null,
                     out_proposed_start_week: null, out_proposed_end_week: null }],
            error: null,
          });
        }
        server.updatedAt = `T${server.updatedAt.slice(1)}+`;
        return Promise.resolve({
          data: [{ out_id: ID, out_updated_at: server.updatedAt, out_conflict: false,
                   out_overlap_kind: null, out_overlap_conflicts: null,
                   out_proposed_start_week: null, out_proposed_end_week: null }],
          error: null,
        });
      }

      if (name === 'bp_upsert_da_time_block_row') {
        // An INSERT sends null and always wins; an UPDATE must match.
        if (expected !== null && expected !== server.updatedAt) {
          server.conflicts.push(String(expected));
          return Promise.resolve({
            data: [{ out_id: ID, updated_at: server.updatedAt, conflict: true }],
            error: null,
          });
        }
        server.updatedAt = `T${server.updatedAt.slice(1)}+`;
        return Promise.resolve({
          data: [{ out_id: ID, updated_at: server.updatedAt, conflict: false }],
          error: null,
        });
      }

      if (name === 'bp_delete_da_time_block_row') {
        if (expected !== server.updatedAt) {
          server.conflicts.push(String(expected));
          return Promise.resolve({
            data: [{ deleted: false, conflict: true, current_updated_at: server.updatedAt }],
            error: null,
          });
        }
        return Promise.resolve({
          data: [{ deleted: true, conflict: false, current_updated_at: null }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    },
  };
  return { builder, rpcFn, server };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import { useResizeDaTimeBlock } from '../hooks/useResizeDaTimeBlock';
import { useUpsertDaTimeBlock } from '../hooks/useUpsertDaTimeBlock';
import { useDeleteDaTimeBlock } from '../hooks/useDeleteDaTimeBlock';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function block(over: Partial<DaTimeBlock> = {}): DaTimeBlock {
  return {
    id: ID,
    da_name: 'Trevor',
    type: 'vacation',
    label: 'Vacation',
    start_week: '2026-08-24',
    end_week: '2026-08-31',
    created_at: 'T0',
    updated_at: 'T0',
    project_id: null,
    ...over,
  };
}

/** What the GRID renders from — the cache, not the server. Every call site
 *  (the two resize handles at DrawScheduleGrid ~1911/1950 and the popup at
 *  ~2802/2811) reads `np.updated_at` off this list. */
function seedList(queryClient: QueryClient, rows: DaTimeBlock[]) {
  queryClient.setQueryData(queryKeys.daTimeBlocks(T), rows);
}
function listNow(queryClient: QueryClient): DaTimeBlock[] {
  return queryClient.getQueryData<DaTimeBlock[]>(queryKeys.daTimeBlocks(T)) ?? [];
}
function tokenInGrid(queryClient: QueryClient): string | undefined {
  return listNow(queryClient).find((r) => r.id === ID)?.updated_at;
}
function warnToasts(): string[] {
  return useToastStore
    .getState()
    .toasts.filter((t) => t.kind === 'warn')
    .map((t) => t.message);
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  mocks.server.updatedAt = 'T0';
  mocks.server.conflicts = [];
  useToastStore.getState().clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ---------------------------------------------------------------------------
// 0e — the reproduction, one per writer
// ---------------------------------------------------------------------------

describe('fix-442 §0e — a second edit of your OWN block, reproduced', () => {
  it('★★★ RESIZE then RESIZE: the second one used to be refused', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, [block()]);
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });

    // 1. First resize, using the token the grid is rendering. Succeeds.
    await act(async () => {
      await result.current.mutateAsync({
        blockId: ID,
        newStartWeek: '2026-08-24',
        newEndWeek: '2026-09-07',
        expectedUpdatedAt: tokenInGrid(queryClient)!,
      });
    });
    expect(mocks.server.conflicts).toEqual([]);

    // ★★★ THE WHOLE BUG IN ONE ASSERTION. The write landed and the server has
    //     moved on, but the GRID still renders the pre-write token until the
    //     refetch arrives — and the user's hand is already on the handle.
    await waitFor(() => expect(tokenInGrid(queryClient)).toBe(mocks.server.updatedAt));

    // 2. Second resize, 1.5 s later, from what the grid shows. Must succeed.
    await act(async () => {
      await result.current.mutateAsync({
        blockId: ID,
        newStartWeek: '2026-08-24',
        newEndWeek: '2026-09-14',
        expectedUpdatedAt: tokenInGrid(queryClient)!,
      });
    });
    expect(mocks.server.conflicts).toEqual([]);
    expect(warnToasts()).toEqual([]);
  });

  it('★★★ EDIT then EDIT (upsert update): the popup reopens on a fresh token', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, [block()]);
    const { result } = renderHook(() => useUpsertDaTimeBlock(), { wrapper });

    // The popup takes its `block` snapshot from the rendered list at click
    // time (DrawScheduleGrid:1837 `block: np`), so this IS the popup's input.
    const first = listNow(queryClient).find((r) => r.id === ID)!;
    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        block: first,
        patch: { type: 'training', label: 'Training' },
      });
    });
    expect(mocks.server.conflicts).toEqual([]);

    await waitFor(() => expect(tokenInGrid(queryClient)).toBe(mocks.server.updatedAt));

    // Reopen the popup — it re-snapshots from the list — and save again.
    const second = listNow(queryClient).find((r) => r.id === ID)!;
    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        block: second,
        patch: { label: 'Training week' },
      });
    });
    expect(mocks.server.conflicts).toEqual([]);
    expect(warnToasts()).toEqual([]);
  });

  it('★★★ EDIT then DELETE: the remove button used to be refused too', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, [block()]);
    const upsert = renderHook(() => useUpsertDaTimeBlock(), { wrapper });
    const del = renderHook(() => useDeleteDaTimeBlock(), { wrapper });

    await act(async () => {
      await upsert.result.current.mutateAsync({
        op: 'update',
        block: listNow(queryClient).find((r) => r.id === ID)!,
        patch: { label: 'Renamed' },
      });
    });
    await waitFor(() => expect(tokenInGrid(queryClient)).toBe(mocks.server.updatedAt));

    // DrawScheduleGrid:2810-2811 sends `npPopup.block.updated_at`.
    const current = listNow(queryClient).find((r) => r.id === ID)!;
    await act(async () => {
      await del.result.current.mutateAsync({
        id: current.id,
        updated_at: current.updated_at!,
      });
    });
    expect(mocks.server.conflicts).toEqual([]);
    expect(warnToasts()).toEqual([]);
    // ★ …and the row is gone from the grid immediately, not after a refetch.
    expect(listNow(queryClient).some((r) => r.id === ID)).toBe(false);
  });

  it('★★★ ADD then EDIT — the exact prod shape (created :17.4, updated :21.3, error :23.1)', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, []);
    const { result } = renderHook(() => useUpsertDaTimeBlock(), { wrapper });

    // Insert: p_expected_updated_at is null, so it always wins.
    await act(async () => {
      await result.current.mutateAsync({
        op: 'insert',
        id: ID,
        patch: {
          da_name: 'Trevor',
          type: 'vacation',
          start_week: '2026-08-24',
          end_week: '2026-08-31',
        },
      });
    });
    // ★★ The new block must be IN the grid with its real token — before this
    //    ticket the list stayed empty until the refetch, and the second action
    //    had nothing correct to read.
    await waitFor(() => expect(tokenInGrid(queryClient)).toBe(mocks.server.updatedAt));

    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        block: listNow(queryClient).find((r) => r.id === ID)!,
        patch: { label: 'PTO' },
      });
    });
    expect(mocks.server.conflicts).toEqual([]);
    expect(warnToasts()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A5 — the guard is kept, not widened
// ---------------------------------------------------------------------------

describe('fix-442 §A5 — a GENUINE conflict still refuses, and still says so', () => {
  it('★★★ another actor moved the row: resize throws and warns, unchanged', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, [block()]);
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });

    // Somebody else writes the row behind our back.
    mocks.server.updatedAt = 'T-someone-else';

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          blockId: ID,
          newStartWeek: '2026-08-24',
          newEndWeek: '2026-09-07',
          expectedUpdatedAt: 'T0',
        });
      }),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(warnToasts()).toContain(
        'Time block changed since you loaded it — refresh and retry',
      ),
    );
    // ★★ fix-341 §1 chose that sentence deliberately; this ticket does not
    //    touch it, does not widen the guard, and does not silently retry.
    expect(mocks.server.conflicts).toEqual(['T0']);
  });

  it('★★ a genuine conflict on UPDATE still throws and still warns', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, [block()]);
    const { result } = renderHook(() => useUpsertDaTimeBlock(), { wrapper });
    mocks.server.updatedAt = 'T-someone-else';

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          op: 'update',
          block: block({ updated_at: 'T0' }),
          patch: { label: 'mine' },
        });
      }),
    ).rejects.toThrow();
    await waitFor(() => expect(warnToasts().length).toBeGreaterThan(0));
    expect(warnToasts()[0]).toContain('Time block');
  });

  it('★★ a genuine conflict on DELETE still throws, and the row STAYS', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, [block()]);
    const { result } = renderHook(() => useDeleteDaTimeBlock(), { wrapper });
    mocks.server.updatedAt = 'T-someone-else';

    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: ID, updated_at: 'T0' });
      }),
    ).rejects.toThrow();
    // ★★★ A REFUSED DELETE MUST NOT REMOVE THE ROW FROM THE GRID. The cache
    //     write belongs on the SUCCESS path only — an optimistic removal here
    //     would show the block gone while the database still holds it.
    expect(listNow(queryClient).some((r) => r.id === ID)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A1–A3 — what the cache holds afterwards
// ---------------------------------------------------------------------------

describe('fix-442 §A — the returned token is written back', () => {
  it('★★ resize replaces start_week / end_week / updated_at, and nothing else', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, [block({ label: 'Vacation', da_name: 'Trevor' })]);
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        blockId: ID,
        newStartWeek: '2026-08-31',
        newEndWeek: '2026-09-14',
        expectedUpdatedAt: 'T0',
      });
    });
    const row = listNow(queryClient).find((r) => r.id === ID)!;
    expect(row.start_week).toBe('2026-08-31');
    expect(row.end_week).toBe('2026-09-14');
    expect(row.updated_at).toBe(mocks.server.updatedAt);
    // ★ A resize is a resize: the label and the owner are not its business.
    expect(row.label).toBe('Vacation');
    expect(row.da_name).toBe('Trevor');
  });

  it('★★★ an OVERLAP response is NOT a write, so the cache must not move', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, [block()]);
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });
    // The RPC answers with a proposal and writes nothing; the caller opens
    // NpResizeConflictPrompt and may re-fire with force=true.
    const overlapping = {
      rpc: () =>
        Promise.resolve({
          data: [{ out_id: ID, out_updated_at: null, out_conflict: false,
                   out_overlap_kind: 'np', out_overlap_conflicts: [],
                   out_proposed_start_week: '2026-08-24',
                   out_proposed_end_week: '2026-09-07' }],
          error: null,
        }),
    };
    const original = mocks.builder.rpc;
    (mocks.builder as { rpc: unknown }).rpc = overlapping.rpc;
    try {
      await act(async () => {
        await result.current.mutateAsync({
          blockId: ID,
          newStartWeek: '2026-08-24',
          newEndWeek: '2026-09-07',
          expectedUpdatedAt: 'T0',
        });
      });
      expect(tokenInGrid(queryClient)).toBe('T0');
      expect(listNow(queryClient).find((r) => r.id === ID)!.end_week).toBe('2026-08-31');
    } finally {
      (mocks.builder as { rpc: unknown }).rpc = original;
    }
  });

  it('★★ an INSERT appends the new row rather than replacing anything', async () => {
    const { queryClient, wrapper } = setup();
    seedList(queryClient, [block({ id: 'np_other', updated_at: 'X' })]);
    const { result } = renderHook(() => useUpsertDaTimeBlock(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        op: 'insert',
        id: ID,
        patch: {
          da_name: 'Ainsley',
          type: 'training',
          start_week: '2026-09-07',
          end_week: '2026-09-07',
        },
      });
    });
    const rows = listNow(queryClient);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === 'np_other')!.updated_at).toBe('X');
    expect(rows.find((r) => r.id === ID)!.da_name).toBe('Ainsley');
  });

  it('★ an empty / absent cache is left alone rather than invented', async () => {
    // The grid may not have loaded yet. Writing a one-row list into an absent
    // cache would make the next refetch look like a change.
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        blockId: ID,
        newStartWeek: '2026-08-24',
        newEndWeek: '2026-09-07',
        expectedUpdatedAt: 'T0',
      });
    });
    expect(queryClient.getQueryData(queryKeys.daTimeBlocks(T))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A4 — the popup snapshot, and why it needed no change
// ---------------------------------------------------------------------------

import popupSrc from '../components/NpBlockEditPopup.tsx?raw';
import gridSrc from '../components/DrawScheduleGrid.tsx?raw';
import resizeSrc from '../hooks/useResizeDaTimeBlock.ts?raw';
import upsertSrc from '../hooks/useUpsertDaTimeBlock.ts?raw';
import deleteSrc from '../hooks/useDeleteDaTimeBlock.ts?raw';

/** Strip block, line and JSX comments — every one of these files discusses
 *  tokens and staleness at length in prose. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-442 §A4 — the edit popup cannot outlive its own save', () => {
  it('the stripper actually stripped', () => {
    expect(resizeSrc).toContain('WRITE THE NEW TOKEN BACK');
    expect(code(resizeSrc)).not.toContain('WRITE THE NEW TOKEN BACK');
  });

  it('★★★ A4 needed NO change: onUpdate and onRemove each close immediately', () => {
    // ★★★ The brief made A4 conditional on "if the popup can stay open across
    //     a save". It cannot: `commit()` calls onAdd/onUpdate and then
    //     `props.onClose()` unconditionally, and the Remove button calls
    //     onRemove() then onClose(). So the snapshot cannot go stale WITHIN a
    //     session, and a REOPENED popup re-snapshots from the rendered list
    //     (DrawScheduleGrid `block: np`) — which A2 has just made fresh.
    const src = code(popupSrc);
    expect(src).toMatch(/props\.onUpdate\([^)]*\);\s*\}\s*props\.onClose\(\);/);
    expect(src).toMatch(/props\.onRemove\(\);\s*props\.onClose\(\);/);
  });

  it('★★ …so this pins it: a future edit that keeps the popup open must revisit A4', () => {
    // If either onClose above is removed, the snapshot outlives its save and
    // the popup would need to read the block from the live list by id.
    const src = code(popupSrc);
    const closes = src.match(/props\.onClose\(\)/g) ?? [];
    expect(closes.length).toBeGreaterThanOrEqual(2);
  });

  it('★★★ every OCC token the grid sends still comes off the rendered row', () => {
    // ★ This is what makes A1–A3 sufficient. The two resize handles and the
    //   popup's two calls all read the LIST, so a fresh list is a fresh token
    //   at every call site — no component needed changing.
    const src = code(gridSrc);
    expect(src).toContain('expectedUpdatedAt: np.updated_at');
    expect(src).toContain('updated_at: npPopup.block.updated_at');
    expect(src).toContain('block: npPopup.block');
  });
});

describe('fix-442 §A5 — the guard, the RPCs and the sentence are untouched', () => {
  it('★★★ fix-341’s message text is byte-identical', () => {
    expect(code(resizeSrc)).toContain(
      "'Time block changed since you loaded it — refresh and retry'",
    );
  });

  it('★★★ nothing retries a conflict, and nothing widened the check', () => {
    for (const [name, src] of [
      ['resize', resizeSrc],
      ['upsert', upsertSrc],
      ['delete', deleteSrc],
    ] as const) {
      const c = code(src);
      // The conflict still throws — it is not swallowed, downgraded or retried.
      expect(c, name).toContain('OCCConflictError');
      expect(c, name).not.toMatch(/force:\s*true/);
      expect(c, name).not.toMatch(/retry\s*[:(]/);
      // ★★ And the cache write is on the SUCCESS path only. An onError or
      //    onMutate write-back would be an optimistic update, which is a
      //    different (and wrong) answer to this bug.
      expect(c, name).toMatch(/onSuccess:[\s\S]*?apply\w+Block\(/);
      expect(c.split('onError:')[1] ?? '', name).not.toMatch(/apply\w+Block\(/);
    }
  });

  it('★★ the RPC names and their arguments are unchanged', () => {
    expect(code(resizeSrc)).toContain('bp_resize_da_time_block');
    expect(code(resizeSrc)).toContain('p_expected_updated_at: input.expectedUpdatedAt');
    expect(code(upsertSrc)).toContain('bp_upsert_da_time_block_row');
    expect(code(deleteSrc)).toContain('bp_delete_da_time_block_row');
  });

  it('★★ all three still invalidate after writing back', () => {
    // The write-back fixes the token; the refetch reconciles everything else.
    for (const [name, src] of [
      ['resize', resizeSrc],
      ['upsert', upsertSrc],
      ['delete', deleteSrc],
    ] as const) {
      expect(code(src), name).toContain('invalidateQueries');
    }
  });
});
