import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
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
//   - Unit Dimensions editor (writes projects.unit_types)
//   - Project Settings modal (mass-edit)
//   - Project Tags chip editor
//   - Future: permits sidebar reorder (writes projects.permit_order)
//
// fix-174: this hook NO LONGER auto-promotes builders into the catalog.
// fix-24b added a best-effort upsert whenever a patch carried a non-empty
// builder_name — but the Project Overview Builder/Owner cell commits each
// field on blur, so a partial/in-progress name ("boy", "stas") got committed
// and promoted on every intermediate blur, littering the builders catalog with
// fragments (same class as the date-field intermediate-value bug). A builder
// must only enter the catalog on an EXPLICIT, COMPLETE commit, which the two
// form-submit RPCs already do server-side + atomically:
//   - new project: bp_create_project_with_permits
//   - settings-modal save: bp_update_project_with_permits
// The overview cell still SAVES builder_name to the project (its own data);
// it just no longer creates a shared catalog row from a not-yet-finalized field.
//
// fix-99: OCC auto-recovery is now the default. mutationFn does a first
// attempt with the caller's expectedUpdatedAt; on OCCConflictError, it
// awaits a refetch of the projects query, reads the server's freshest
// updated_at out of the cache, and retries ONCE with that token. If the
// retry succeeds, React Query sees one happy lifecycle (snapshot patched
// once, onSuccess fired once with the retry's response). If the retry
// also OCCs (real concurrent edit), the rejection bubbles to onError
// and the existing "modified by someone else" toast fires.
//
// Promoted from fix-98's bespoke writeTypes wrapper in UnitDimensions so
// every caller of this hook (Builder/Owner, Tags, ProjectSettingsModal,
// external team selects, future editors) inherits the recovery for free.
//
// silentOnOcc is preserved as an escape hatch for callers that want to
// suppress the OCC toast AND skip the auto-retry (i.e. handle recovery
// themselves). Default is auto-retry on.

export interface UpdateProjectInput {
  projectId: string;
  expectedUpdatedAt: string;
  patch: Partial<Project>;
  fieldLabel?: string;
  /** fix-98 / fix-99: opt-out of the hook's default auto-recovery.
   *  When true:
   *    - the hook does NOT auto-retry on OCC (caller handles recovery),
   *    - the hook does NOT push the "modified by someone else" toast.
   *  Rollback + invalidate still fire so a follow-up retry on the
   *  caller's side has the freshest possible token. Leave undefined
   *  for the default (auto-retry once on OCC + toast on final failure)
   *  — that's what every standard editor wants. */
  silentOnOcc?: boolean;
}

interface MutationContext {
  snapshot: Project[] | undefined;
}

/** Single-attempt project update. Returns the persisted row on success,
 *  throws OCCConflictError on a 0-row update, throws any other supabase
 *  error verbatim. fix-174: no builder-catalog side effect — a builder only
 *  enters the catalog via the form-submit RPCs (see header comment). */
async function tryUpdateProject(
  input: UpdateProjectInput,
  expectedUpdatedAt: string,
): Promise<Project> {
  const { projectId, patch, fieldLabel } = input;
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
}

/** fix-99: after an OCC failure, refetch the projects query and read
 *  the server's freshest updated_at out of the cache. Returns null if
 *  the cache didn't move forward (rare: same row still has the stale
 *  token, or the project disappeared); the caller surfaces the
 *  original OCC error in that case rather than retrying with the same
 *  stale token. */
async function refreshTokenAfterOcc(
  queryClient: QueryClient,
  tenantId: string,
  projectId: string,
  staleToken: string,
): Promise<string | null> {
  await queryClient.refetchQueries({
    queryKey: queryKeys.projects(tenantId),
  });
  const fresh = queryClient
    .getQueryData<Project[]>(queryKeys.projects(tenantId))
    ?.find((p) => p.id === projectId);
  if (!fresh?.updated_at || fresh.updated_at === staleToken) return null;
  return fresh.updated_at;
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<Project, Error, UpdateProjectInput, MutationContext>({
    mutationFn: async (input) => {
      try {
        return await tryUpdateProject(input, input.expectedUpdatedAt);
      } catch (err) {
        // silentOnOcc=true → caller wants to handle recovery itself.
        // Don't auto-retry; let the error propagate. (Non-OCC errors
        // also propagate so the caller can surface whatever it wants.)
        if (input.silentOnOcc === true) throw err;
        // Non-OCC errors always propagate to onError so the generic
        // "Could not save project" toast fires.
        if (!isOCCConflict(err)) throw err;
        // Default OCC recovery: refetch, read fresh token, retry once.
        const freshToken = await refreshTokenAfterOcc(
          queryClient,
          tenantId,
          input.projectId,
          input.expectedUpdatedAt,
        );
        // Cache didn't move forward — surrender to the original OCC
        // rather than retrying with the same stale token.
        if (freshToken === null) throw err;
        // Retry once. Any error from here (OCC or otherwise) propagates
        // to onError so the user finally sees what's going on. We do
        // NOT chain a second auto-retry — exactly one attempt after the
        // refresh.
        return await tryUpdateProject(input, freshToken);
      }
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
        // silentOnOcc still gates the toast for the opt-out path —
        // callers handling their own recovery don't want a noisy
        // intermediate flash. For the default (auto-retry) path, the
        // toast fires only when BOTH attempts failed: that's a real
        // concurrent edit and the user needs to know.
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
