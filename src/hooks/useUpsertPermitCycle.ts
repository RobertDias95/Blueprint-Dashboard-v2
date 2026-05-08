import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
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
// Cache target: queryKeys.permitsByProject(projectId) and queryKeys.permits.
// Cycles live nested under each permit's permit_cycles[] array. Optimistic
// patch walks both caches; rollback restores both on error.

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

/** Build the full date-field jsonb payload by merging current cycle values
 *  with the user's patch. Empty string for missing values so NULLIF in the
 *  RPC can normalize to SQL NULL. */
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

      // UPDATE — merge current cycle values with patch.
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
      await queryClient.cancelQueries({ queryKey: queryKeys.permits });
      await queryClient.cancelQueries({
        queryKey: queryKeys.permitsByProject(input.projectId),
      });
      const globalSnapshot = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permits,
      );
      const byProjectSnapshot = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(input.projectId),
      );

      const apply = (rows: PermitWithCycles[] | undefined) =>
        rows?.map((p) => {
          if (p.id !== input.permitId) return p;
          const cycles = p.permit_cycles ?? [];
          if (input.op === 'insert') {
            // Append a temp cycle; replaced with server row on success.
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

      queryClient.setQueryData(queryKeys.permits, apply(globalSnapshot));
      queryClient.setQueryData(
        queryKeys.permitsByProject(input.projectId),
        apply(byProjectSnapshot),
      );

      return { globalSnapshot, byProjectSnapshot };
    },

    onError: (error, input, context) => {
      if (context?.globalSnapshot !== undefined) {
        queryClient.setQueryData(queryKeys.permits, context.globalSnapshot);
      }
      if (context?.byProjectSnapshot !== undefined) {
        queryClient.setQueryData(
          queryKeys.permitsByProject(input.projectId),
          context.byProjectSnapshot,
        );
      }
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.permits });
        queryClient.invalidateQueries({
          queryKey: queryKeys.permitsByProject(input.projectId),
        });
      } else {
        pushToast(`Could not save cycle — ${error.message}`, 'error');
      }
    },

    onSuccess: () => {
      // Realtime will arrive via permit_cycles invalidation; force one refetch
      // now to replace the optimistic temp row (INSERT case) with the real row.
      queryClient.invalidateQueries({ queryKey: queryKeys.permits });
      pushToast('Saved cycle', 'success');
    },
  });
}
