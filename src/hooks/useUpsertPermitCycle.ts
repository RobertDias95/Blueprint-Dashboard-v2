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
    const existingIdx = next.findIndex((c) => c.id === snap.id);
    if (existingIdx >= 0) {
      next[existingIdx] = snap;
    } else {
      // Snap created a new cycle row OR snap updated an existing row whose
      // current id we hadn't loaded — either way, find/replace by
      // cycle_index, falling back to append.
      const byIndex = next.findIndex(
        (c) => c.cycle_index === snap.cycle_index,
      );
      if (byIndex >= 0) {
        next[byIndex] = snap;
      } else {
        next = [...next, snap];
      }
    }
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
        const { data, error } = await supabase.rpc('bp_upsert_permit_cycle_row', {
          p_id: input.cycle.id,
          p_data: merged,
          p_expected_updated_at: input.cycle.updated_at,
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
      let parentPermitUpdatedAt: string | null = null;
      try {
        const { data: permitRow } = await supabase
          .from('permits')
          .select('updated_at')
          .eq('id', input.permitId)
          .single();
        if (permitRow && typeof permitRow.updated_at === 'string') {
          parentPermitUpdatedAt = permitRow.updated_at;
        }
      } catch {
        // Network blip on the auxiliary fetch — leave parentPermitUpdatedAt
        // null; the existing invalidate path will eventually refresh the
        // cache. The user just loses the fast-path on this one save.
      }

      return { cycle: editedCycle, snapCycle, parentPermitUpdatedAt };
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
