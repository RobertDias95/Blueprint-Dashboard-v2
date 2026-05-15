import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
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
// Cache target: queryKeys.permitsByProject and queryKeys.permits, both
// tenant-scoped. Cycles live nested under each permit's permit_cycles[].

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

export function useUpsertPermitCycle() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<PermitCycle, Error, UpsertCycleInput, MutationContext>({
    mutationFn: async (input) => {
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
        const row = (data as { out_id: string; updated_at: string; conflict: boolean }[])[0];
        if (!row) throw new Error('Insert returned no row');
        return {
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
      }

      const merged = buildFullPayload(input.cycle, input.patch);
      const { data, error } = await supabase.rpc('bp_upsert_permit_cycle_row', {
        p_id: input.cycle.id,
        p_data: merged,
        p_expected_updated_at: input.cycle.updated_at,
      });
      if (error) throw error;
      const row = (data as { out_id: string; updated_at: string; conflict: boolean }[])[0];
      if (!row) throw new Error('Update returned no row');
      if (row.conflict) {
        throw new OCCConflictError(input.permitId, 'Cycle');
      }
      return {
        ...input.cycle,
        ...input.patch,
        id: row.out_id,
        updated_at: row.updated_at,
      };
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
        pushToast(`Could not save cycle — ${error.message}`, 'error');
      }
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
      pushToast('Saved cycle', 'success');
    },
  });
}
