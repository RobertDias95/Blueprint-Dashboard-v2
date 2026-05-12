import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';

// Q9.5.e-fix-3: Row-level OCC mutation for project fields. Mirror of
// useUpdatePermit. The fix-3 migration installs a projects_set_updated_at
// trigger so the OCC token refreshes server-side after every UPDATE.
//
// Used by:
//   - External team selects (writes projects.external_team[type] = firm)
//   - Builder/Owner cell (writes projects.builder_id)
//   - Future: permits sidebar reorder (writes projects.permit_order)

export interface UpdateProjectInput {
  projectId: string;
  expectedUpdatedAt: string;
  patch: Partial<Project>;
  fieldLabel?: string;
}

interface MutationContext {
  snapshot: Project[] | undefined;
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<Project, Error, UpdateProjectInput, MutationContext>({
    mutationFn: async ({ projectId, expectedUpdatedAt, patch, fieldLabel }) => {
      const { data, error } = await supabase
        .from('projects')
        .update(patch)
        .eq('id', projectId)
        .eq('updated_at', expectedUpdatedAt)
        .select('*');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new OCCConflictError(0, fieldLabel ?? 'Project');
      }
      return data[0] as Project;
    },

    onMutate: async ({ projectId, patch }) => {
      const key = queryKeys.projects(tenantId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<Project[]>(key);
      queryClient.setQueryData<Project[] | undefined>(key, (rows) =>
        rows?.map((p) => (p.id === projectId ? { ...p, ...patch } : p)),
      );
      return { snapshot };
    },

    onError: (error, _input, context) => {
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData(queryKeys.projects(tenantId), context.snapshot);
      }
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.projects(tenantId) });
      } else {
        pushToast(`Could not save project — ${error.message}`, 'error');
      }
    },

    onSuccess: (project) => {
      queryClient.setQueryData<Project[] | undefined>(
        queryKeys.projects(tenantId),
        (rows) => rows?.map((p) => (p.id === project.id ? project : p)),
      );
    },
  });
}
