import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { isUserInputValidationError } from '../lib/errorLogger';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// Q4: Row-level OCC upsert for permit_cycles via bp_upsert_permit_cycle_row.
//
// Two modes via discriminated union:
//   { op: 'insert' } — new cycle, server generates uuid. Caller passes the
//                      cycle_index it wants (typically max(existing) + 1).
//   { op: 'update' } — existing cycle. Caller passes the full current cycle
//                      object; the hook merges patch into the current values
//                      and ships all 5 date fields to the RPC (full-row
//                      payload contract — see Migration 3 design notes).
//
// Server-side snap behavior the RPC performs after a successful write (see
// migrations fix_24c_2_snap_update_if_null, fix_24c_3_snap_on_resubmitted_too,
// fix_25a_b_intake_snap_gated_to_design):
//   - intake_accepted on DESIGN cycle (cycle_index = 0) → INSERT-or-
//     UPDATE-if-NULL cycle 1.submitted with intake date.
//   - resubmitted on REVIEW cycle (cycle_index >= 1) → INSERT-or-
//     UPDATE-if-NULL cycle N+1.submitted with resubmitted date.
//   - intake_accepted on a review cycle is data noise (V1 model) and does
//     NOT trigger snap. resubmitted on the design cycle likewise no-ops.
//   - city_target, corr_issued, submitted (alone) never trigger snap.
//
// fix-25d-residual: RPC now also returns the snap-created cycle row
// (snap_id / snap_cycle_index / snap_submitted / snap_updated_at).
// onSuccess merges BOTH the edited row AND the snap row into both
// cache keys (permits + permitsByProject) via setQueryData. No
// invalidate roundtrip — highlight calc sees the snap cycle on the
// same render pass that resolves the mutation.
//
// ===========================================================================
// ★★★ fix-341 §1 — "Cycle was modified by someone else", with nobody else there
// ===========================================================================
//
// Shire, backfilling 25 W Dravus St alone on 2026-08-18, hit it twice. The
// database says exactly what happened (user_activity, to the millisecond):
//
//   20:01:40.655  cycle 1 UPDATE resubmitted   +  cycle 2 INSERT   ← ONE call
//   20:01:41.786  ✗ "Cycle was modified by someone else"
//   20:01:48.352  cycle 2 UPDATE submitted     +  cycle 1 UPDATE resubmitted
//   20:01:49.360  ✗ same error
//   20:01:52.071  both rows written — the retry succeeded
//
// ★★ ONE CALL WRITES TWO ROWS. Setting `resubmitted` on cycle N makes the RPC
// snap cycle N+1's `submitted` (the fix-24c/25a rules above), which bumps
// N+1's `updated_at`. The user then tabs to that very cell — a review row is
// entered left to right, so the next thing they touch is usually the row the
// snap just wrote — and their save carries the token from BEFORE the snap.
// Same family as fix-73 and fix-76: a write invalidates more stamps than the
// caller refreshes.
//
// ★★★ THE GUARD IS NOT THE BUG AND IS NOT TOUCHED. It is the only thing
// standing between two editors and a silent overwrite; loosening it would
// trade a false alarm for lost work. Three changes, none of which weaken it:
//
//   1. ★ THE TOKEN IS READ AT EXECUTION, NOT AT KEYSTROKE. `input.cycle` is
//      captured when the cell renders and can be seconds old by the time the
//      user blurs it. The cache, by contrast, is patched with the server's
//      authoritative stamps by every onSuccess (including the snap row's).
//      `freshUpdatedAt` prefers the cache's value and falls back to the
//      caller's. It can only ever be a stamp the SERVER handed us — the
//      optimistic patch in onMutate deliberately touches date fields and never
//      `updated_at` — so a real concurrent edit still mismatches and still
//      fails. That is asserted.
//
//   2. ★★ WRITES ARE SERIALISED. `scope` makes React Query run cycle
//      mutations one at a time app-wide, so save B starts after save A's
//      stamps have landed rather than racing the snap A is about to perform.
//      Two saves 300ms apart on adjacent cells are the exact shape that failed.
//
//   3. ★ EVERY STAMP THE WRITE TOUCHED IS REFRESHED, not just the two rows the
//      RPC happens to report. One auxiliary read now returns the parent
//      permit's `updated_at` AND every sibling cycle's — so a future trigger
//      that touches a third row cannot reopen this, and the fix does not
//      depend on the RPC's reporting staying complete.

export type DateField =
  | 'submitted'
  | 'city_target'
  | 'corr_issued'
  | 'resubmitted'
  | 'intake_accepted';

export type CyclePatch = Partial<Pick<PermitCycle, DateField>>;

export type UpsertCycleInput = {
  permitId: number;
  projectId: string;
  patch: CyclePatch;
} & (
  | { op: 'insert'; cycleIndex: number }
  | { op: 'update'; cycle: PermitCycle }
);

interface RpcRow {
  out_id: string;
  updated_at: string;
  conflict: boolean;
  snap_id: string | null;
  snap_cycle_index: number | null;
  snap_submitted: string | null;
  snap_updated_at: string | null;
}

/** Result of a successful mutation — exposes the snap row when one fired
 *  so callers / tests can assert against the post-snap cache.
 *
 *  fix-76: parentPermitUpdatedAt carries the post-RPC value of permits.updated_at
 *  for the parent permit. The cycle save server-side bumps the parent's
 *  updated_at (via denormalized columns / triggers — same pattern as
 *  bp_set_bp_dd_dates from fix-73), and any DateCell mounted on that permit
 *  was sending the stale OCC token until the next refetch landed. onSuccess
 *  patches the permits caches with this so the very next DateCell save uses
 *  the fresh token. */
export interface UpsertCycleResult {
  cycle: PermitCycle;
  snapCycle: PermitCycle | null;
  parentPermitUpdatedAt: string | null;
  /** ★ fix-341: `updated_at` for EVERY cycle on this permit, read back after
   *  the write. The RPC reports the row it edited and the one it snapped; this
   *  covers whatever else the write touched, so the next save on any sibling
   *  carries a token the server will accept. */
  cycleStamps: Record<string, string>;
}

/** ★ fix-341: the freshest `updated_at` this client has for a cycle — the
 *  cache's, which every onSuccess patches from the server's response, falling
 *  back to the value the caller captured at render time.
 *
 *  ★ IT NEVER INVENTS A TOKEN. `onMutate` patches date fields optimistically
 *  and deliberately leaves `updated_at` alone, so anything found here came from
 *  a server response. A row genuinely changed by somebody else still carries
 *  the stamp we last read, and the guard still rejects the write. */
export function freshestCycleStamp(
  caches: ReadonlyArray<PermitWithCycles[] | undefined>,
  permitId: number,
  cycleId: string,
  fallback: string,
): string {
  for (const rows of caches) {
    const permit = rows?.find((p) => p.id === permitId);
    const cycle = permit?.permit_cycles?.find((c) => c.id === cycleId);
    if (cycle?.updated_at) return cycle.updated_at;
  }
  return fallback;
}

interface MutationContext {
  globalSnapshot: PermitWithCycles[] | undefined;
  byProjectSnapshot: PermitWithCycles[] | undefined;
}

const DATE_FIELDS: DateField[] = [
  'submitted',
  'city_target',
  'corr_issued',
  'resubmitted',
  'intake_accepted',
];

function buildFullPayload(
  base: Partial<Record<DateField, string | null>>,
  patch: CyclePatch,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of DATE_FIELDS) {
    const v = patch[f] !== undefined ? patch[f] : base[f];
    out[f] = v ?? '';
  }
  return out;
}

/** Apply the edited + (optional) snap cycle to one PermitWithCycles row.
 *  Insert path adds the edited row + any snap row to permit_cycles.
 *  Update path replaces the edited row in place AND merges or inserts
 *  the snap row. */
function mergePermitCycles(
  permit: PermitWithCycles,
  permitId: number,
  edited: PermitCycle,
  snap: PermitCycle | null,
  op: 'insert' | 'update',
  parentPermitUpdatedAt: string | null,
  cycleStamps: Record<string, string> = {},
): PermitWithCycles {
  if (permit.id !== permitId) return permit;
  const cycles = permit.permit_cycles ?? [];

  let next: PermitCycle[];
  if (op === 'insert') {
    // Remove any prior temp placeholder for this cycle_index, then add.
    const filtered = cycles.filter(
      (c) =>
        !(typeof c.id === 'string' && c.id.startsWith('temp-')) ||
        c.cycle_index !== edited.cycle_index,
    );
    next = [...filtered, edited];
  } else {
    next = cycles.map((c) => (c.id === edited.id ? edited : c));
  }

  if (snap) {
    // ★★ fix-341: the snap row the RPC reports carries only `submitted` (that
    // is all the snap writes), so REPLACING the cached row with it wiped
    // city_target / corr_issued / resubmitted from the cache — and this hook
    // ships a FULL-ROW payload built from the cached values, so the very next
    // save on that row would have written those nulls back to the database.
    // Patching preserves everything the snap did not touch.
    const patchSnap = (existing: PermitCycle): PermitCycle => ({
      ...existing,
      submitted: snap.submitted,
      cycle_index: snap.cycle_index,
      id: snap.id,
      updated_at: snap.updated_at,
    });
    const existingIdx = next.findIndex((c) => c.id === snap.id);
    if (existingIdx >= 0) {
      next[existingIdx] = patchSnap(next[existingIdx]);
    } else {
      // Snap created a new cycle row OR snap updated an existing row whose
      // current id we hadn't loaded — either way, find/replace by
      // cycle_index, falling back to append.
      const byIndex = next.findIndex(
        (c) => c.cycle_index === snap.cycle_index,
      );
      if (byIndex >= 0) {
        next[byIndex] = patchSnap(next[byIndex]);
      } else {
        next = [...next, snap];
      }
    }
  }

  // ★★ fix-341: and the stamps for EVERY sibling the write touched, read back
  // in the same round trip as the permit's. The RPC reports two rows; this
  // covers the rest, so a save on any row of this permit carries a token the
  // server will accept. Applied AFTER the edited/snap merges so the
  // authoritative read-back wins on the rows it knows about.
  if (Object.keys(cycleStamps).length > 0) {
    next = next.map((c) =>
      cycleStamps[c.id] && cycleStamps[c.id] !== c.updated_at
        ? { ...c, updated_at: cycleStamps[c.id] }
        : c,
    );
  }

  // fix-76: also patch permit.updated_at when the cycle save bumped it
  // server-side. The Approval Date / other permit-level DateCells read this
  // value as their OCC token; without the patch, the next save lands stale.
  return {
    ...permit,
    permit_cycles: next,
    ...(parentPermitUpdatedAt
      ? { updated_at: parentPermitUpdatedAt }
      : {}),
  };
}

export function useUpsertPermitCycle() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<UpsertCycleResult, Error, UpsertCycleInput, MutationContext>({
    // ★★ fix-341: ONE CYCLE WRITE AT A TIME. React Query runs mutations sharing
    // a scope id in series, so the save on cycle N+1 starts after the save on
    // cycle N has landed AND its snap stamp has been merged — instead of
    // racing the very write that is about to bump its row. Shire's two errors
    // were 1.1s and 1.0s after the write that invalidated their token.
    //
    // ★ App-wide rather than per-permit because the id is fixed at hook
    // definition and the variables are not available here. The cost is nil:
    // these are one-person keystroke saves, ~150ms each, and the alternative
    // is the race this ticket exists to remove.
    scope: { id: 'permit-cycle-write' },
    mutationFn: async (input) => {
      let row: RpcRow | undefined;
      let editedCycle: PermitCycle;

      if (input.op === 'insert') {
        const dataPayload = {
          permit_id: input.permitId,
          cycle_index: input.cycleIndex,
          ...buildFullPayload({}, input.patch),
        };
        const { data, error } = await supabase.rpc('bp_upsert_permit_cycle_row', {
          p_id: null,
          p_data: dataPayload,
          p_expected_updated_at: null,
        });
        if (error) throw error;
        row = (data as RpcRow[])[0];
        if (!row) throw new Error('Insert returned no row');
        editedCycle = {
          id: row.out_id,
          permit_id: input.permitId,
          cycle_index: input.cycleIndex,
          submitted: input.patch.submitted ?? null,
          city_target: input.patch.city_target ?? null,
          corr_issued: input.patch.corr_issued ?? null,
          resubmitted: input.patch.resubmitted ?? null,
          intake_accepted: input.patch.intake_accepted ?? null,
          created_at: row.updated_at,
          updated_at: row.updated_at,
        };
      } else {
        const merged = buildFullPayload(input.cycle, input.patch);
        // ★★ fix-341: the token comes from the CACHE, which every onSuccess
        // patches with the server's stamps — including the snap row's. The
        // caller's copy was captured when the cell rendered and may predate a
        // sibling write from moments ago. See freshestCycleStamp: this can
        // only ever be a stamp the server gave us, so a genuine conflict still
        // fails.
        const expectedUpdatedAt = freshestCycleStamp(
          [
            queryClient.getQueryData<PermitWithCycles[]>(
              queryKeys.permitsByProject(tenantId, input.projectId),
            ),
            queryClient.getQueryData<PermitWithCycles[]>(
              queryKeys.permits(tenantId),
            ),
          ],
          input.permitId,
          input.cycle.id,
          input.cycle.updated_at,
        );
        const { data, error } = await supabase.rpc('bp_upsert_permit_cycle_row', {
          p_id: input.cycle.id,
          p_data: merged,
          p_expected_updated_at: expectedUpdatedAt,
        });
        if (error) throw error;
        row = (data as RpcRow[])[0];
        if (!row) throw new Error('Update returned no row');
        if (row.conflict) {
          throw new OCCConflictError(input.permitId, 'Cycle');
        }
        editedCycle = {
          ...input.cycle,
          ...input.patch,
          id: row.out_id,
          updated_at: row.updated_at,
        };
      }

      // Build the snap cycle (if RPC reported one). Fields we don't know
      // — city_target / corr_issued / resubmitted / intake_accepted —
      // default to null on the snap row. The snap creates / updates a
      // row whose only meaningful date is `submitted` (per the snap
      // rules); subsequent edits via this same hook will fill in the
      // other fields on later passes.
      let snapCycle: PermitCycle | null = null;
      if (
        row.snap_id !== null &&
        row.snap_cycle_index !== null &&
        row.snap_updated_at !== null
      ) {
        snapCycle = {
          id: row.snap_id,
          permit_id: input.permitId,
          cycle_index: row.snap_cycle_index,
          submitted: row.snap_submitted,
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          intake_accepted: null,
          created_at: row.snap_updated_at,
          updated_at: row.snap_updated_at,
        };
      }

      // fix-76: pull the parent permit's fresh updated_at. The RPC bumps it
      // server-side (via triggers / denormalized columns), but the cycle row
      // returned above only carries the cycle's own updated_at. Without this
      // fetch, the next save on a permit-level DateCell (Approval Date,
      // Actual Issue, …) still sends the pre-RPC OCC token and hits a
      // conflict. Mirrors the fix-73 setQueryData write that closed the
      // same race on bp_set_bp_dd_dates + bp_update_project_with_permits.
      //
      // ★★ fix-341 widens it to the SIBLINGS as well. The same round trip now
      // returns every cycle's `updated_at` for this permit, so "refresh the
      // stamps for all the rows the write touched" does not depend on the RPC
      // reporting each of them — a trigger added next year that bumps a third
      // row cannot reopen the false alarm.
      let parentPermitUpdatedAt: string | null = null;
      const cycleStamps: Record<string, string> = {};
      try {
        const { data: permitRow } = await supabase
          .from('permits')
          .select('updated_at, permit_cycles(id, updated_at)')
          .eq('id', input.permitId)
          .single();
        if (permitRow && typeof permitRow.updated_at === 'string') {
          parentPermitUpdatedAt = permitRow.updated_at;
        }
        const rows = (permitRow as { permit_cycles?: unknown } | null)
          ?.permit_cycles;
        if (Array.isArray(rows)) {
          for (const r of rows as { id?: unknown; updated_at?: unknown }[]) {
            if (typeof r?.id === 'string' && typeof r?.updated_at === 'string') {
              cycleStamps[r.id] = r.updated_at;
            }
          }
        }
      } catch {
        // Network blip on the auxiliary fetch — leave the stamps empty; the
        // existing invalidate path will eventually refresh the cache. The user
        // just loses the fast-path on this one save.
      }

      return { cycle: editedCycle, snapCycle, parentPermitUpdatedAt, cycleStamps };
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.permits(tenantId) });
      await queryClient.cancelQueries({
        queryKey: queryKeys.permitsByProject(tenantId, input.projectId),
      });
      const globalSnapshot = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permits(tenantId),
      );
      const byProjectSnapshot = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(tenantId, input.projectId),
      );

      const apply = (rows: PermitWithCycles[] | undefined) =>
        rows?.map((p) => {
          if (p.id !== input.permitId) return p;
          const cycles = p.permit_cycles ?? [];
          if (input.op === 'insert') {
            const temp: PermitCycle = {
              id: `temp-${Math.random()}`,
              permit_id: input.permitId,
              cycle_index: input.cycleIndex,
              submitted: input.patch.submitted ?? null,
              city_target: input.patch.city_target ?? null,
              corr_issued: input.patch.corr_issued ?? null,
              resubmitted: input.patch.resubmitted ?? null,
              intake_accepted: input.patch.intake_accepted ?? null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            return { ...p, permit_cycles: [...cycles, temp] };
          }
          return {
            ...p,
            permit_cycles: cycles.map((c) =>
              c.id === input.cycle.id ? { ...c, ...input.patch } : c,
            ),
          };
        });

      queryClient.setQueryData(queryKeys.permits(tenantId), apply(globalSnapshot));
      queryClient.setQueryData(
        queryKeys.permitsByProject(tenantId, input.projectId),
        apply(byProjectSnapshot),
      );

      return { globalSnapshot, byProjectSnapshot };
    },

    onError: (error, input, context) => {
      if (context?.globalSnapshot !== undefined) {
        queryClient.setQueryData(queryKeys.permits(tenantId), context.globalSnapshot);
      }
      if (context?.byProjectSnapshot !== undefined) {
        queryClient.setQueryData(
          queryKeys.permitsByProject(tenantId, input.projectId),
          context.byProjectSnapshot,
        );
      }
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
        queryClient.invalidateQueries({
          queryKey: queryKeys.permitsByProject(tenantId, input.projectId),
        });
      } else {
        // fix-26a: strip the "bp_upsert_permit_cycle_row:" prefix that
        // PL/pgSQL RAISE EXCEPTION prepends so the user sees just the
        // validation message (e.g., "intake_accepted (2026-05-10) cannot
        // precede submitted (2026-05-15)"), not the function name.
        const cleaned = error.message.replace(
          /^bp_upsert_permit_cycle_row:\s*/,
          '',
        );
        // fix-165: a chronology rejection (SQLSTATE 22008, the fix-89 guard) is
        // user input, not a system error — show it inline but don't log it to
        // Error Reports. `log: false` keeps it out of the frontend_toast path;
        // the global MutationCache.onError skips the backend_rpc path too
        // (shouldSkipBackendRpcLog), so neither path creates a row.
        const isUserValidation = isUserInputValidationError(error);
        pushToast(`Could not save cycle — ${cleaned}`, 'error', {
          log: !isUserValidation,
        });
      }
    },

    onSuccess: (result, input) => {
      // fix-25d-residual: merge the real edited row + any snap row
      // into BOTH cache keys synchronously. This collapses the prior
      // ~10-15s window where the snap row was server-only and the
      // chain-position highlight couldn't land on the snapped cell
      // until something (window focus, route change) refetched.
      const apply = (rows: PermitWithCycles[] | undefined) =>
        rows?.map((p) =>
          mergePermitCycles(
            p,
            input.permitId,
            result.cycle,
            result.snapCycle,
            input.op,
            result.parentPermitUpdatedAt,
            result.cycleStamps,
          ),
        );

      queryClient.setQueryData<PermitWithCycles[]>(
        queryKeys.permits(tenantId),
        (rows) => apply(rows),
      );
      queryClient.setQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(tenantId, input.projectId),
        (rows) => apply(rows),
      );

      pushToast('Saved cycle', 'success');
    },
  });
}
