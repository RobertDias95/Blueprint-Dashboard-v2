import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// Q4: Row-level OCC delete for permit_cycles via bp_delete_permit_cycle_row.

export interface DeleteCycleInput {
  cycle: PermitCycle;
  permitId: number;
  projectId: string;
}

interface MutationContext {
  globalSnapshot: PermitWithCycles[] | undefined;
  byProjectSnapshot: PermitWithCycles[] | undefined;
}

export function useDeletePermitCycle() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeleteCycleInput, MutationContext>({
    mutationFn: async ({ cycle, permitId }) => {
      const { data, error } = await supabase.rpc('bp_delete_permit_cycle_row', {
        p_id: cycle.id,
        p_expected_updated_at: cycle.updated_at,
      });
      if (error) throw error;
      const row = (
        data as {
          deleted: boolean;
          conflict: boolean;
          current_updated_at: string | null;
        }[]
      )[0];
      if (!row) throw new Error('Delete returned no row');
      if (row.conflict) {
        throw new OCCConflictError(permitId, 'Cycle');
      }
    },

    onMutate: async ({ cycle, permitId, projectId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.permits });
      await queryClient.cancelQueries({
        queryKey: queryKeys.permitsByProject(projectId),
      });
      const globalSnapshot = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permits,
      );
      const byProjectSnapshot = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(projectId),
      );
      const apply = (rows: PermitWithCycles[] | undefined) =>
        rows?.map((p) =>
          p.id !== permitId
            ? p
            : {
                ...p,
                permit_cycles: (p.permit_cycles ?? []).filter(
                  (c) => c.id !== cycle.id,
                ),
              },
        );
      queryClient.setQueryData(queryKeys.permits, apply(globalSnapshot));
      queryClient.setQueryData(
        queryKeys.permitsByProject(projectId),
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
      } else {
        pushToast(`Could not delete cycle — ${error.message}`, 'error');
      }
    },

    onSuccess: () => {
      pushToast('Deleted cycle', 'success');
    },
  });
}
