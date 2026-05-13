import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';

// Q9.5.f-fix-16 E: row-level OCC delete for a project. Server-side FKs
// cascade through draw_schedule / permits / project_documents and SET NULL
// on intake_records, so the RPC body is just one DELETE — no client-side
// ordering needed.

export interface DeleteProjectInput {
  projectId: string;
  expectedUpdatedAt: string;
}

interface DeleteResult {
  deleted: boolean;
  conflict: boolean;
  current_updated_at: string | null;
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<void, Error, DeleteProjectInput>({
    mutationFn: async ({ projectId, expectedUpdatedAt }) => {
      const { data, error } = await supabase.rpc('bp_delete_project_row', {
        p_id: projectId,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw error;
      const row = (data as DeleteResult[] | null)?.[0];
      if (!row || row.conflict) {
        throw new OCCConflictError(0, 'Project');
      }
    },

    onSuccess: (_data, { projectId }) => {
      // Drop the deleted project from the projects cache + invalidate
      // anything that may have referenced it.
      queryClient.setQueryData<Project[] | undefined>(
        queryKeys.projects(tenantId),
        (rows) => rows?.filter((p) => p.id !== projectId),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitsByProject(tenantId, projectId),
      });
      pushToast('Project deleted.', 'success');
    },

    onError: (error) => {
      pushToast(`Could not delete project — ${error.message}`, 'error');
    },
  });
}
