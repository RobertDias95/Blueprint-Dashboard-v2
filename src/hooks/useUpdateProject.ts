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
//
// fix-24b: when the patch contains a non-empty builder_name, we also
// upsert the typed builder into the public.builders catalog so it shows
// up in future autocomplete searches. ON CONFLICT (name, company)
// DO NOTHING preserves existing curated entries. Best-effort: if the
// catalog upsert fails (network blip, RLS), we log and swallow — the
// project save itself already committed and the user got their success
// toast. The wizard's bp_create_project_with_permits path does the
// equivalent server-side and atomically.
//
// TODO (fix-24f or later): consolidate both project-write paths into a
// single bp_update_project_with_builder_promote RPC so this stops
// being two non-atomic client writes.

export interface UpdateProjectInput {
  projectId: string;
  expectedUpdatedAt: string;
  patch: Partial<Project>;
  fieldLabel?: string;
  /** fix-98: when true, an OCCConflictError from the server will NOT
   *  push the "modified by someone else" toast. Rollback + invalidate
   *  still fire. The caller is expected to handle recovery (refetch +
   *  retry) and surface its own messaging if the recovery fails. Used
   *  by UnitDimensions to do a silent first attempt and only toast on
   *  a confirmed second-attempt failure. */
  silentOnOcc?: boolean;
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
      // fix-24b: auto-promote the typed builder into the catalog when
      // the patch carries a builder_name. tenantId comes from authStore
      // (closure capture below); RLS ensures the caller can only update
      // projects in their active tenant, so the catalog row's tenant
      // matches by construction.
      const typedName =
        typeof patch.builder_name === 'string'
          ? patch.builder_name.trim()
          : '';
      if (typedName !== '' && tenantId !== '') {
        const company =
          typeof patch.builder_company === 'string'
            ? patch.builder_company.trim() || null
            : null;
        const email =
          typeof patch.builder_email === 'string'
            ? patch.builder_email.trim() || null
            : null;
        const phone =
          typeof patch.builder_phone === 'string'
            ? patch.builder_phone.trim() || null
            : null;
        const { error: promoteError } = await supabase
          .from('builders')
          .upsert(
            {
              name: typedName,
              company,
              email,
              phone,
              tenant_id: tenantId,
            },
            // ignoreDuplicates so the existing catalog row's email/phone
            // aren't overwritten by whatever the user typed this time.
            { onConflict: 'name,company', ignoreDuplicates: true },
          );
        if (promoteError) {
          // Swallow — best-effort. The project save already succeeded.
          // Next save attempt will retry the catalog upsert.
          console.warn(
            '[useUpdateProject] builder auto-promote failed:',
            promoteError.message,
          );
        }
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

    onError: (error, input, context) => {
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData(queryKeys.projects(tenantId), context.snapshot);
      }
      if (isOCCConflict(error)) {
        // fix-98: silentOnOcc lets the caller handle recovery (refetch +
        // retry) without a noisy intermediate toast. Rollback + invalidate
        // still fire so a follow-up retry has the freshest possible token.
        if (input.silentOnOcc !== true) {
          pushToast(error.message, 'warn');
        }
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
