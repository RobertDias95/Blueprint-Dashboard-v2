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
//   - Builder/Owner cell (writes the builder_* text fields, and — fix-425 —
//     projects.builder_id when a builder is PICKED from the catalog menu or
//     the name is cleared). ★ This comment described a real write that lived
//     for one day: Q9.5.f-fix-17 (e8a5aed, 2026-05-13) upserted a builder and
//     set projects.builder_id; Q9.5.f-fix-22 (9d2269c, 2026-05-14) removed it
//     with the project-level field migration and nothing replaced it. The
//     comment then outlived the code by three and a half months, which is how
//     202 projects ended up with 33 links, all of them from the import.
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

// ===========================================================================
// ★★★ fix-532 §B (P-246) — THE STALE TOKEN WAS THE CALLER'S, NOT A WRITER'S
// ===========================================================================
//
// Gena, prod `error_reports` #717, 2026-09-11 11:05:02 PT — *"Unit Dimensions
// changed since you loaded it"*, `write: projects.update`, one occurrence, one
// user. §B asked which WRITER of `projects` fails to put the fresh
// `updated_at` back. **Enumerated from `pg_proc` and the client, the answer is
// none of them** — all eight server functions and every client caller either
// write the token back or invalidate `projects` (see the PR for the list).
//
// ★★★ THE STALE VALUE WAS THE ONE THE EDITOR HELD. `writeTypes` sends
//     `project.updated_at` — read off a PROP at render time — and the Unit
//     Dimensions editor calls it **on every field change**, not on blur. Type a
//     width and then a depth and two saves are in flight carrying the SAME
//     token, because the second was composed before the first's `onSuccess`
//     re-rendered its prop.
//
//     Two is survivable: the second OCCs, fix-99 refetches, retries once and
//     wins. **Three is not** — the third's single retry can carry a token the
//     second has already superseded, and `mutationFn` does not chain a second
//     auto-retry. That is one toast, from one user, on a row whose final
//     `updated_at` is ten seconds later: exactly row #717.
//
// ★★★ SO THE FIX IS TO STOP SENDING A RENDER-CAPTURED TOKEN AT ALL. The cache
//     is the one place that always holds a REAL server token — `onMutate`'s
//     optimistic patch deliberately keeps the old `updated_at`, and
//     `onSuccess` replaces the row with the server's — so reading it at SEND
//     time closes the window that a re-render was being relied on to close.
//
// ⚠️ AND IT DOES NOT WEAKEN OCC, which is the thing to get right. A write by
//    SOMEBODY ELSE reaches this cache through `REALTIME_TABLES.projects`
//    (`projects` is published — verified on prod 2026-09-11) or through the
//    invalidation every other writer already fires. The token is still the
//    server's, still compared server-side, and a genuine concurrent edit still
//    refuses. What stops happening is a tab refusing ITSELF.

/** The freshest token this client has for `projectId`, or the caller's.
 *
 *  ★ NEVER a token the caller has not seen: if the cache has no row, the
 *    caller's value stands, so a surface that loads a project outside the
 *    `projects` query is unaffected.
 *  ★★ `fail closed` does not apply here and it is worth saying why — an
 *     unreadable cache means "use what you were given", which is exactly
 *     today's behaviour. The strict direction would be to refuse the write,
 *     and refusing a save because a cache was cold would be a worse bug than
 *     the one this fixes. */
export function freshestProjectToken(
  cached: Project[] | undefined,
  projectId: string,
  callerToken: string,
): string {
  const row = cached?.find((p) => p.id === projectId);
  return row?.updated_at ?? callerToken;
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<Project, Error, UpdateProjectInput, MutationContext>({
    // ★★★ fix-511 §C (P-198): what a failed save was writing, for the error
    //     report. This is the hook that produced prod row 696 — the Site
    //     card writes the TABLE directly (fix-415), through no RPC at all,
    //     so `projects.update` is the honest name for it.
    meta: { write: 'projects.update' },
    mutationFn: async (input) => {
      // ★★★ fix-532 §B: the token is read HERE, at send time, not at render
      //     time. See the note above `freshestProjectToken`.
      const token = freshestProjectToken(
        queryClient.getQueryData<Project[]>(queryKeys.projects(tenantId)),
        input.projectId,
        input.expectedUpdatedAt,
      );
      try {
        return await tryUpdateProject(input, token);
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
          token,
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
