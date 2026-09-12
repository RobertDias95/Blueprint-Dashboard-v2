import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { mayEditLibrary } from '../lib/workDataNames';
import type { Project, UnitType } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-532 §A (P-026) — CAM CAN EDIT THE LIBRARY, AND THE RPC IS THE GATE
// ===========================================================================
//
// fix-527 §B built `bp_update_library_fields` and proved its gate against prod
// inside a rolled-back transaction: no capability → `42501`, with it →
// succeeds, revoked → refused on the very next call. **Nothing called it.**
// This is the caller.
//
// ★★★ MEASURED 2026-09-11: `cameron@blueprintcap.com` is the ONLY holder of
//     `profiles.may_edit_library`, granted by Cowork per Bobby's ruling. This
//     ticket grants it to nobody and builds no role model.
//
// ⚠️⚠️ THE BROWSER CHECK IS COSMETIC AND THE RPC IS THE GATE. ~20
//      `useIsTenantAdmin` sites hide a control in the browser and enforce
//      nothing (P-243); within a tenant every user is equivalent server-side.
//      So `useMayEditLibrary` decides whether to RENDER an input, and a `42501`
//      from the server is the truth if the two ever disagree — surfaced as a
//      sentence a person can act on, never the driver's.

/**
 * Does the signed-in user hold the Library capability?
 *
 * ★★★ ONE READ, FROM `profiles`, OF THE CALLER'S OWN ROW. `profiles_read_own`
 *     is `auth.uid() = id OR is_admin()`, so this needs no RPC and no elevated
 *     path — a user asking about themselves is the policy's own case.
 *
 * ★★★ FAIL CLOSED, which is fix-527's rule carried forward: a missing row, a
 *     null, an error and a query still in flight all answer **false**. An
 *     unreadable capability is a no, and `mayEditLibrary` is the one predicate
 *     that decides it — `undefined` reads exactly like `false` there, which is
 *     what keeps this honest before Cowork applies anything.
 */
export function useMayEditLibrary(): boolean {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const q = useQuery<{ may_edit_library: boolean | null } | null>({
    queryKey: ['libraryCapability', userId ?? ''],
    enabled: !!userId,
    // ★ A capability change is rare and deliberate (an admin calls
    //   `bp_set_library_capability`). A minute keeps the Library from asking on
    //   every tab switch, and §A's "takes effect on the next call" is the
    //   SERVER's promise, not this cache's — the RPC re-reads the row itself.
    staleTime: 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('may_edit_library')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { may_edit_library: boolean | null } | null;
    },
  });
  return mayEditLibrary(q.data);
}

/** The five fields `bp_update_library_fields` accepts. ★ Listed rather than a
 *  free patch: an RPC that applies whatever it is handed is an UPDATE with
 *  extra steps, and the capability would gate nothing. */
export interface LibraryFieldPatch {
  zone?: string | null;
  alley?: string | null;
  lot_width?: number | null;
  lot_depth?: number | null;
  unit_types?: UnitType[] | null;
}

export interface UpdateLibraryFieldsInput {
  projectId: string;
  patch: LibraryFieldPatch;
  /** What the toast calls the thing that did not save. */
  fieldLabel: string;
}

interface RpcRow {
  out_updated_at: string;
  out_conflict: boolean;
}

/** ★ The server's own sentence is `bp_update_library_fields: caller may not
 *  edit Library fields`, which names a function at somebody who was typing a
 *  lot width. This is what they read instead. */
export const LIBRARY_DENIED_MESSAGE =
  'You do not have permission to edit Library fields. Ask an admin if you need it.';

export function useUpdateLibraryFields() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<
    { updatedAt: string; conflict: boolean },
    Error,
    UpdateLibraryFieldsInput
  >({
    // ★ fix-511 §C: what a failed save was writing, for the error report.
    meta: { write: 'bp_update_library_fields' },
    mutationFn: async (input) => {
      // ★★★ fix-532 §B's rule, applied here from the first line rather than
      //     retrofitted: the OCC token is read from the CACHE at send time, not
      //     handed in by a component that rendered a moment ago. The Library's
      //     cells fire a save per field exactly as the Unit Dimensions editor
      //     does, so it has the same three-in-flight shape.
      const cached = queryClient.getQueryData<Project[]>(queryKeys.projects(tenantId));
      const expected = cached?.find((p) => p.id === input.projectId)?.updated_at ?? null;
      const { data, error } = await supabase.rpc('bp_update_library_fields', {
        p_project_id: input.projectId,
        p_expected_updated_at: expected,
        p_zone: input.patch.zone ?? null,
        p_alley: input.patch.alley ?? null,
        p_lot_width: input.patch.lot_width ?? null,
        p_lot_depth: input.patch.lot_depth ?? null,
        p_unit_types: input.patch.unit_types ?? null,
      });
      if (error) {
        // ★★★ `42501` IS THE GATE SPEAKING, and it is the one error that is not
        //     a fault. A browser that rendered the control for somebody who has
        //     since lost the capability lands here, which is exactly the
        //     disagreement §A says the server wins.
        if (error.code === '42501') throw new Error(LIBRARY_DENIED_MESSAGE);
        throw error;
      }
      const row = (data as RpcRow[] | null)?.[0];
      if (!row) throw new Error('bp_update_library_fields returned no row');
      return { updatedAt: row.out_updated_at, conflict: row.out_conflict };
    },

    onSuccess: (result, input) => {
      if (result.conflict) {
        pushToast(
          `${input.fieldLabel} changed since you loaded it — nothing was saved. Try again.`,
          'warn',
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectsAll });
        return;
      }
      // ★★★ §A3 — THE FRESH TOKEN GOES INTO EVERY CACHE THAT HOLDS THIS
      //     PROJECT, not just the one this screen reads. fix-442 taught one
      //     cache and fix-511 found everybody else still stale; the Library
      //     list and the project card are the SAME `projects` query, so one
      //     `setQueryData` on the bare prefix reaches both — and the patch goes
      //     in with it, so the row a person is looking at does not flicker back
      //     to its old value before the refetch lands.
      queryClient.setQueryData<Project[] | undefined>(
        queryKeys.projects(tenantId),
        (rows) =>
          rows?.map((p) =>
            p.id === input.projectId
              ? { ...p, ...input.patch, updated_at: result.updatedAt }
              : p,
          ),
      );
      // ★ …and the bare prefix, so any other tenant's cached copy or a
      //   differently-keyed consumer refetches rather than holding the old row.
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectsAll });
    },

    onError: (error, input) => {
      pushToast(`Could not save ${input.fieldLabel} — ${error.message}`, 'error');
    },
  });
}
