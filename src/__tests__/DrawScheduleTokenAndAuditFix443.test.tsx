import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { queryKeys } from '../lib/queryKeys';
import type { DrawScheduleRow } from '../lib/database.types';

// ===========================================================================
// fix-443 — two Draw Schedule debts
// ===========================================================================
//
// §A (P-095): the project-block hooks learn the returned OCC token. This is
// PREVENTION — `error_reports` holds ZERO "Draw schedule changed since you
// loaded it" rows (measured on prod 2026-08-29). fix-442 fixed the identical
// shape on the NP blocks, where it had fired six times.
//
// ★★★ AND THE BRIEF'S 0a WAS FALSIFIED FOR TWO OF THE THREE HOOKS.
// `useUpdateDrawSchedule` (onSuccess ~:166) and `useResolveDaOverlap`
// (onSuccess ~:114) ALREADY write the returned token back, each with a comment
// naming the exact race ("Bug B fix" / "the same stale-OCC race we fixed in
// Q6.2.a-fix"). My own fix-442 report was wrong to flag them: it read the
// OPTIMISTIC setQueryData in `onMutate` at ~:99 and stopped there. Only
// `useMoveDrawScheduleDa` had the gap. These tests pin all three so the claim
// is checkable rather than remembered.

const T = 'test-tenant-uuid';
const PID = '3e1f84c4-92fe-4c70-aaa2-2758c5f13d68';

const mocks = vi.hoisted(() => {
  const rpcFn = vi.fn();
  /** Server truth: one draw row whose updated_at advances on every write. */
  const server = { updatedAt: 'T0', conflicts: [] as string[] };
  const builder = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      const expected =
        (args.p_expected_updated_at as string | undefined) ??
        (args.p_anchor_expected_updated_at as string | undefined) ??
        null;
      const conflicted = expected !== server.updatedAt;
      if (conflicted) server.conflicts.push(String(expected));
      if (!conflicted) server.updatedAt = `${server.updatedAt}+`;

      if (name === 'bp_move_draw_schedule_da') {
        return Promise.resolve({
          data: [{
            out_project_id: PID,
            out_updated_at: conflicted ? null : server.updatedAt,
            out_conflict: conflicted,
            out_old_da: 'Trevor',
            out_permits_updated: 2,
            out_tasks_updated: 3,
            out_gap_exists: false,
            out_gap_downstream_count: 0,
            out_gap_after_week: null,
          }],
          error: null,
        });
      }
      if (name === 'bp_update_draw_schedule_with_dd_sync') {
        return Promise.resolve({
          data: [{
            out_project_id: PID,
            out_updated_at: conflicted ? null : server.updatedAt,
            out_conflict: conflicted,
          }],
          error: null,
        });
      }
      if (name === 'bp_resolve_da_overlap') {
        return Promise.resolve({
          data: [{
            out_anchor_project_id: PID,
            out_anchor_updated_at: conflicted ? null : server.updatedAt,
            out_pushed_project_ids: conflicted ? [] : ['pushed-1', 'pushed-2'],
            out_conflict: conflicted,
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    },
  };
  return { builder, rpcFn, server };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import { useMoveDrawScheduleDa } from '../hooks/useMoveDrawScheduleDa';
import { useUpdateDrawSchedule } from '../hooks/useUpdateDrawSchedule';
import { useResolveDaOverlap } from '../hooks/useResolveDaOverlap';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function drawRow(over: Partial<DrawScheduleRow> = {}): DrawScheduleRow {
  return {
    project_id: PID,
    da_assigned: 'Trevor',
    start_week: '2026-09-07',
    end_week: '2026-09-28',
    status: 'active',
    updated_at: 'T0',
    ...over,
  } as DrawScheduleRow;
}

/** What the GRID renders from. Every drag reads `updated_at` off this row for
 *  the next RPC's `p_expected_updated_at`. */
function seed(qc: QueryClient, rows: DrawScheduleRow[]) {
  qc.setQueryData(queryKeys.drawSchedule(T), rows);
}
function tokenInGrid(qc: QueryClient): string | undefined {
  return qc
    .getQueryData<DrawScheduleRow[]>(queryKeys.drawSchedule(T))
    ?.find((r) => r.project_id === PID)?.updated_at;
}
function rowInGrid(qc: QueryClient): DrawScheduleRow | undefined {
  return qc
    .getQueryData<DrawScheduleRow[]>(queryKeys.drawSchedule(T))
    ?.find((r) => r.project_id === PID);
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
// A3 — red→green, one per hook
// ---------------------------------------------------------------------------

describe('fix-443 §A (P-095) — a second move within the refetch window', () => {
  it('★★★ MOVE then MOVE — this is the one that was broken', async () => {
    const { queryClient, wrapper } = setup();
    seed(queryClient, [drawRow()]);
    const { result } = renderHook(() => useMoveDrawScheduleDa(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: PID,
        newDa: 'Ainsley',
        newDm: 'Lindsay',
        startWeek: '2026-09-14',
        endWeek: '2026-10-05',
        scheduleStatus: 'active',
        expectedUpdatedAt: tokenInGrid(queryClient)!,
      });
    });
    expect(mocks.server.conflicts).toEqual([]);

    // ★★★ THE ASSERTION THAT WAS RED. The write landed and the server moved
    //     on; the grid must not still be rendering the pre-write token.
    await waitFor(() =>
      expect(tokenInGrid(queryClient)).toBe(mocks.server.updatedAt),
    );

    // A second drag, before any refetch, from what the grid shows.
    await act(async () => {
      await result.current.mutateAsync({
        projectId: PID,
        newDa: 'Cam',
        newDm: null,
        startWeek: '2026-09-21',
        endWeek: '2026-10-12',
        scheduleStatus: 'active',
        expectedUpdatedAt: tokenInGrid(queryClient)!,
      });
    });
    expect(mocks.server.conflicts).toEqual([]);
    expect(warnToasts()).toEqual([]);
  });

  it('★★ …and the row shows what the move asked for, not a stale snapshot', async () => {
    const { queryClient, wrapper } = setup();
    seed(queryClient, [drawRow({ da_assigned: 'Trevor' })]);
    const { result } = renderHook(() => useMoveDrawScheduleDa(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        projectId: PID,
        newDa: 'Ainsley',
        newDm: 'Lindsay',
        startWeek: '2026-09-14',
        endWeek: '2026-10-05',
        scheduleStatus: 'paused',
        expectedUpdatedAt: 'T0',
      });
    });
    const row = rowInGrid(queryClient)!;
    expect(row.da_assigned).toBe('Ainsley');
    expect(row.start_week).toBe('2026-09-14');
    expect(row.end_week).toBe('2026-10-05');
    expect(row.status).toBe('paused');
    expect(row.updated_at).toBe(mocks.server.updatedAt);
  });

  it('★★ UPDATE then UPDATE — already green before this ticket, pinned so it stays', async () => {
    const { queryClient, wrapper } = setup();
    seed(queryClient, [drawRow()]);
    const { result } = renderHook(() => useUpdateDrawSchedule(), { wrapper });
    for (const week of ['2026-09-14', '2026-09-21']) {
      await act(async () => {
        await result.current.mutateAsync({
          projectId: PID,
          expectedUpdatedAt: tokenInGrid(queryClient)!,
          daAssigned: 'Trevor',
          startWeek: week,
          endWeek: '2026-10-05',
          scheduleStatus: 'active',
        });
      });
    }
    expect(mocks.server.conflicts).toEqual([]);
    expect(tokenInGrid(queryClient)).toBe(mocks.server.updatedAt);
  });

  it('★★ PUSH-DOWN then PUSH-DOWN — also already green, pinned', async () => {
    const { queryClient, wrapper } = setup();
    seed(queryClient, [drawRow()]);
    const { result } = renderHook(() => useResolveDaOverlap(), { wrapper });
    for (const week of ['2026-09-14', '2026-09-21']) {
      await act(async () => {
        await result.current.mutateAsync({
          anchorProjectId: PID,
          expectedUpdatedAt: tokenInGrid(queryClient)!,
          daAssigned: 'Ainsley',
          startWeek: week,
          endWeek: '2026-10-05',
          scheduleStatus: 'active',
        });
      });
    }
    expect(mocks.server.conflicts).toEqual([]);
    expect(warnToasts()).toEqual([]);
  });

  it('★★★ A2’s caveat: the PUSHED rows get no token, and none is invented', async () => {
    // bp_resolve_da_overlap returns out_pushed_project_ids but NO per-row
    // updated_at for them, so guessing one would put a fabricated OCC token in
    // the cache — worse than the stale one. They stay to the invalidate, and
    // the hook's own comment has said so since Q6.2.b.
    const { queryClient, wrapper } = setup();
    seed(queryClient, [drawRow(), drawRow({ project_id: 'pushed-1', updated_at: 'P0' } as Partial<DrawScheduleRow>)]);
    const { result } = renderHook(() => useResolveDaOverlap(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        anchorProjectId: PID,
        expectedUpdatedAt: 'T0',
        daAssigned: 'Ainsley',
        startWeek: '2026-09-14',
        endWeek: '2026-10-05',
        scheduleStatus: 'active',
      });
    });
    const pushed = queryClient
      .getQueryData<DrawScheduleRow[]>(queryKeys.drawSchedule(T))
      ?.find((r) => r.project_id === 'pushed-1');
    expect(pushed?.updated_at).toBe('P0');
  });

  it('★★★ a GENUINE conflict still throws and still warns — the guard is untouched', async () => {
    const { queryClient, wrapper } = setup();
    seed(queryClient, [drawRow()]);
    const { result } = renderHook(() => useMoveDrawScheduleDa(), { wrapper });
    mocks.server.updatedAt = 'T-someone-else';

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          projectId: PID,
          newDa: 'Ainsley',
          newDm: null,
          startWeek: '2026-09-14',
          endWeek: '2026-10-05',
          scheduleStatus: 'active',
          expectedUpdatedAt: 'T0',
        });
      }),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(warnToasts()).toContain(
        'Draw schedule changed since you loaded it — refresh and retry',
      ),
    );
    // ★ …and the cache was NOT moved by a refused write.
    expect(tokenInGrid(queryClient)).toBe('T0');
  });
});

// ---------------------------------------------------------------------------
// §B — the migration text
// ---------------------------------------------------------------------------

const MIGRATION_PATH = 'migrations/fix_443_draw_schedule_audit_dd_and_source.sql';
const MIGRATION = readFileSync(resolve(process.cwd(), MIGRATION_PATH), 'utf8');
const PRIOR = readFileSync(
  resolve(process.cwd(), 'migrations/fix_207_draw_schedule_audit.sql'),
  'utf8',
);

/** Comment-stripped. This file explains every rule at length in prose, which
 *  is exactly how an assertion matches a paragraph instead of the SQL. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

/** The twelve app writers, measured from pg_proc on prod 2026-08-29. */
const WRITERS = [
  'bp_create_project_with_permits',
  'bp_delete_draw_schedule_row',
  'bp_move_draw_schedule_da',
  'bp_place_new_project_on_da',
  'bp_replace_draw_schedule',
  'bp_resolve_da_overlap',
  'bp_set_bp_dd_dates',
  'bp_shift_da_blocks_up',
  'bp_sync_draw_schedule_da',
  'bp_update_draw_schedule_with_dd_sync',
  'bp_update_redesign_dd_phase',
  'bp_upsert_draw_schedule_row',
];

describe('fix-443 §B (P-029) — the migration says what the audit needs', () => {
  it('the comment stripper actually stripped', () => {
    expect(MIGRATION).toContain('THE WRITER INVENTORY');
    expect(SQL).not.toContain('THE WRITER INVENTORY');
  });

  it('★★★ B1: the four dd columns, as `date`, nullable, added not replaced', () => {
    for (const c of ['dd_start_from', 'dd_start_to', 'dd_end_from', 'dd_end_to']) {
      expect(SQL, c).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\s+date`));
    }
    // ★ No new grants and no new view — the table keeps fix-207's posture and
    //   the post-fix-273 truncate revoke.
    expect(SQL).not.toMatch(/\bGRANT\b/);
    expect(SQL).not.toMatch(/CREATE (OR REPLACE )?VIEW/i);
  });

  it('★★★ B2: dd_start / dd_end join the EARLY-RETURN, which is the real fix', () => {
    // Adding them to the INSERT lists alone would only record dd moves that
    // some other column already made auditable. This is what makes a dd-ONLY
    // write produce a row at all.
    expect(SQL).toMatch(
      /AND NEW\.dd_start\s+IS NOT DISTINCT FROM OLD\.dd_start[\s\S]{0,120}AND NEW\.dd_end\s+IS NOT DISTINCT FROM OLD\.dd_end THEN/,
    );
  });

  it('★★ B2: all THREE insert branches carry the new columns', () => {
    const inserts = SQL.match(/INSERT INTO public\.draw_schedule_audit\(/g) ?? [];
    expect(inserts).toHaveLength(3);
    const cols = SQL.match(/dd_start_from, dd_start_to, dd_end_from, dd_end_to\)/g) ?? [];
    expect(cols).toHaveLength(3);
    // UPDATE carries OLD→NEW, INSERT carries NULL→NEW, DELETE carries OLD→NULL.
    expect(SQL).toContain('OLD.dd_start, NEW.dd_start, OLD.dd_end, NEW.dd_end)');
    expect(SQL).toContain('NULL, NEW.dd_start, NULL, NEW.dd_end)');
    expect(SQL).toContain('OLD.dd_start, NULL, OLD.dd_end, NULL)');
  });

  it('★★★ B2: the trigger function keeps its signature, so no overload is made', () => {
    // A trigger function takes no arguments, so this one is safe to CREATE OR
    // REPLACE outright — unlike the twelve writers below. fix-438's lesson.
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.bp_audit_draw_schedule()');
    expect(PRIOR).toContain('bp_audit_draw_schedule()');
    // Same modifiers as fix-207's definition.
    for (const m of ['RETURNS trigger', 'LANGUAGE plpgsql', 'SECURITY DEFINER']) {
      expect(SQL, m).toContain(m);
    }
  });

  it('★★★ B3: every one of the twelve writers is named for tagging', () => {
    for (const w of WRITERS) {
      expect(SQL, w).toContain(`'${w}'`);
    }
    // ★ …and the one-off import helper is deliberately NOT in the list.
    expect(SQL).not.toContain("'migrate_auxiliary'");
  });

  it('★★★ B3: NO writer is CREATE OR REPLACEd with a retyped signature', () => {
    // ★★★ THE FIX-438 GUARANTEE, MADE STRUCTURAL. A `CREATE OR REPLACE` with a
    //     changed argument list is an OVERLOAD, not a replacement. Rather than
    //     retyping twelve signatures — four of which have no file in
    //     migrations/ to copy from — the migration reads each live definition
    //     and splices one line in, so the signature CANNOT change.
    for (const w of WRITERS) {
      expect(SQL, w).not.toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION\\s+(public\\.)?${w}\\s*\\(`),
      );
    }
    // The only CREATE OR REPLACE in the file is the trigger function.
    const creates = SQL.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
    expect(creates).toHaveLength(1);
    // And the splice is anchored, idempotent, and refuses to guess.
    expect(SQL).toContain('pg_get_functiondef(v_oid)');
    expect(SQL).toContain("v_def LIKE '%set_config(''app.ds_source''%'");
    expect(SQL).toContain('refusing to guess');
  });

  it('★★ B3: the tag is TRANSACTION-LOCAL, which is why it cannot leak', () => {
    // The third argument to set_config is `is_local`. Without it the value
    // would survive on a pooled connection and mislabel the next writer.
    expect(SQL).toMatch(/set_config\(''app\.ds_source'', %L, true\)/);
  });

  it('★★ B4: no backfill — the 247 NULL-source rows are left alone', () => {
    expect(SQL).not.toMatch(/UPDATE\s+public\.draw_schedule_audit/i);
    expect(SQL).not.toMatch(/DELETE\s+FROM\s+public\.draw_schedule_audit/i);
    expect(MIGRATION).toContain('NO BACKFILL, DELIBERATELY');
  });

  it('★ it is one transaction, and it is not applied by the PR', () => {
    expect(SQL.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(SQL).toContain('COMMIT;');
    expect(MIGRATION).toContain('NOTHING IN HERE IS APPLIED BY THE PR');
  });
});

// ---------------------------------------------------------------------------
// B5 — nothing in the app reads this table
// ---------------------------------------------------------------------------

describe('fix-443 §B5 — no UI change, because nothing reads the audit', () => {
  it('★★ the only mention of draw_schedule_audit in src/ is a COMMENT', () => {
    // Grepped 2026-08-29: one hit, in lib/vendorReport's header prose. There is
    // no reader to extend, so B5 adds nothing rather than inventing a screen.
    const vendor = readFileSync(
      resolve(process.cwd(), 'src/lib/vendorReport.ts'),
      'utf8',
    );
    expect(vendor).toContain('draw_schedule_audit');
    const executable = vendor
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(executable).not.toContain('draw_schedule_audit');
  });
});

// ---------------------------------------------------------------------------
// §A source contract
// ---------------------------------------------------------------------------

import moveSrc from '../hooks/useMoveDrawScheduleDa.ts?raw';
import updateSrc from '../hooks/useUpdateDrawSchedule.ts?raw';
import overlapSrc from '../hooks/useResolveDaOverlap.ts?raw';

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-443 §A — source contract', () => {
  it('★★★ all three hooks now write the token in onSuccess', () => {
    for (const [name, src] of [
      ['move', moveSrc],
      ['update', updateSrc],
      ['overlap', overlapSrc],
    ] as const) {
      const c = code(src);
      expect(c, name).toMatch(/onSuccess:[\s\S]*?setQueryData[\s\S]*?updated_at:/);
    }
  });

  it('★★ …and all three still invalidate, and still throw on a real conflict', () => {
    for (const [name, src] of [
      ['move', moveSrc],
      ['update', updateSrc],
      ['overlap', overlapSrc],
    ] as const) {
      const c = code(src);
      expect(c, name).toContain('invalidateQueries');
      expect(c, name).toContain('OCCConflictError');
      // fix-341's sentence, unchanged.
      expect(c, name).toContain('Draw schedule changed since you loaded it');
    }
  });

  it('★★ the optimistic onMutate and its rollback are untouched in the two that had them', () => {
    // A1 said keep them exactly as they are: the optimistic patch is what makes
    // the drag feel instant, and the snapshot rollback is what undoes it.
    for (const [name, src] of [
      ['update', updateSrc],
      ['overlap', overlapSrc],
    ] as const) {
      const c = code(src);
      expect(c, name).toContain('onMutate:');
      expect(c, name).toMatch(/drawSnapshot/);
    }
  });
});
