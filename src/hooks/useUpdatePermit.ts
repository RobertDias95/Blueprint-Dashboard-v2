import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import type { Permit, PermitWithCycles } from '../lib/database.types';

// Q3: Row-level OCC mutation for permit fields. Architectural primitive #2:
// every write is row-level OCC. Replaces v1's bp_replace_permit_full
// wholesale pattern.
//
// Wire shape:
//   UPDATE permits SET <patch> WHERE id = $1 AND updated_at = $2
//
// On match: server's update trigger refreshes updated_at, returns the new
// row. On mismatch: 0 rows match → we throw OCCConflictError → caller
// rolls back the optimistic update + refetches.

export interface UpdatePermitInput {
  permitId: number;
  projectId: string;
  expectedUpdatedAt: string;
  /** Partial patch — only the fields the user actually changed. */
  patch: Partial<Permit>;
  /** Field name for OCC conflict messaging. */
  fieldLabel?: string;
}

interface MutationContext {
  globalSnapshot: PermitWithCycles[] | undefined;
  byProjectSnapshot: PermitWithCycles[] | undefined;
}

export function useUpdatePermit() {
  const queryClient = useQueryClient();

  return useMutation<PermitWithCycles, Error, UpdatePermitInput, MutationContext>({
    mutationFn: async ({ permitId, expectedUpdatedAt, patch, fieldLabel }) => {
      const { data, error } = await supabase
        .from('permits')
        .update(patch)
        .eq('id', permitId)
        .eq('updated_at', expectedUpdatedAt)
        .select('*, permit_cycles(*)');

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new OCCConflictError(permitId, fieldLabel);
      }
      return data[0] as PermitWithCycles;
    },

    onMutate: async ({ permitId, projectId, patch }) => {
      // Cancel in-flight refetches so they don't overwrite our optimistic state.
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
        rows?.map((p) => (p.id === permitId ? { ...p, ...patch } : p));

      queryClient.setQueryData(queryKeys.permits, apply(globalSnapshot));
      queryClient.setQueryData(
        queryKeys.permitsByProject(projectId),
        apply(byProjectSnapshot),
      );

      return { globalSnapshot, byProjectSnapshot };
    },

    onError: (error, variables, context) => {
      // Rollback both caches.
      if (context?.globalSnapshot !== undefined) {
        queryClient.setQueryData(queryKeys.permits, context.globalSnapshot);
      }
      if (context?.byProjectSnapshot !== undefined) {
        queryClient.setQueryData(
          queryKeys.permitsByProject(variables.projectId),
          context.byProjectSnapshot,
        );
      }

      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        // Refetch the row so the user sees current server state.
        queryClient.invalidateQueries({ queryKey: queryKeys.permits });
        queryClient.invalidateQueries({
          queryKey: queryKeys.permitsByProject(variables.projectId),
        });
      } else {
        pushToast(
          `Could not save${variables.fieldLabel ? ' ' + variables.fieldLabel : ''} — ${error.message}`,
          'error',
        );
      }
    },

    onSuccess: (data, variables) => {
      // Merge the authoritative server row (new updated_at) into both caches.
      // Realtime will eventually arrive too, but this keeps the OCC token
      // fresh for any immediate follow-up edit on the same field.
      const merge = (rows: PermitWithCycles[] | undefined) =>
        rows?.map((p) => (p.id === variables.permitId ? data : p));
      queryClient.setQueryData(queryKeys.permits, (prev: PermitWithCycles[] | undefined) =>
        merge(prev),
      );
      queryClient.setQueryData(
        queryKeys.permitsByProject(variables.projectId),
        (prev: PermitWithCycles[] | undefined) => merge(prev),
      );
      pushToast(`Saved ${variables.fieldLabel ?? 'change'}`, 'success');
    },
  });
}
