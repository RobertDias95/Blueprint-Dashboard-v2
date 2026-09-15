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

// ===========================================================================
// ★★★ fix-562 §G (P-274) — THE RPC CAN CLEAR A FIELD NOW, AND GAINED THREE
// ===========================================================================
//
// Cam holds `may_edit_library` and still could not edit most of the Library.
// Measured on prod 2026-09-15, the block was in two different places and only
// one of them was a permission:
//
//   · parking · roof deck · stories · qty · width · depth · size all live
//     inside `p_unit_types`, and zone and alley are parameters — so the SERVER
//     accepted every one of them already. **The SCREEN never offered them.**
//     §G is mostly wiring, not granting.
//   · `is_corner_lot`, `juris` and `lot_size_sf` were NOT parameters, so those
//     three were genuinely impossible server-side. The RPC gains them.
//
// ★★★ AND THE DEFECT NOBODY WOULD HAVE FOUND UNTIL IT COST SOMETHING: every
//     assignment in the old function was `coalesce(p_X, pr.X)`, so **passing
//     null meant LEAVE UNCHANGED**. A backfiller who typed a wrong zone could
//     not blank it — the Library's own `—` option called `onSave({ zone: null })`
//     and the row silently kept its old value, with a success toast. That is a
//     save that lies, and it shipped in fix-532.
//
// ★★★ THE SHAPE ADOPTED IS KEY PRESENCE, NOT A SENTINEL. `p_patch jsonb`, and
//     the function writes `col = CASE WHEN p_patch ? 'col' THEN … ELSE pr.col
//     END` — so a key present with a null VALUE writes null, and an absent key
//     leaves the column alone. Two reasons it beats a per-field
//     `p_X_set boolean`:
//
//       · `bp_update_project_with_permits` already works exactly this way, so
//         this is the established idiom here rather than a second convention
//         (fix-326's rule);
//       · a sentinel has to be a value the column can never hold, and there is
//         no such string for `zone` or such number for `lot_size_sf`.
//
// ★★ IT IS STILL NOT A FREE PATCH. The function whitelists the eight keys by
//    name and RAISES on anything else, so "an RPC that applies whatever it is
//    handed is an UPDATE with extra steps" stays false. A typo is loud.
//
// ★ `juris` is `NOT NULL` on `projects` (0 of 221 blank, measured), so the
//   function refuses a null juris with a sentence rather than letting Postgres
//   answer with a constraint name.

/** The eight fields `bp_update_library_fields` accepts.
 *
 *  ★★★ EVERY KEY IS `| null` AND A PRESENT NULL CLEARS. `undefined` (the key
 *  absent) is what means "leave alone" — which is why this is built with
 *  `Object.prototype.hasOwnProperty`-grade care below rather than by spreading
 *  a value that might be `undefined`. */
export interface LibraryFieldPatch {
  zone?: string | null;
  alley?: string | null;
  lot_width?: number | null;
  lot_depth?: number | null;
  /** ★ fix-562 §G: blank on 179 of 221 — the biggest hole in the Library. */
  lot_size_sf?: number | null;
  /** ★ fix-562 §G: tri-state; `null` is "nobody has answered" (fix-122). */
  is_corner_lot?: boolean | null;
  /** ★ fix-562 §G: wired for CORRECTION, not for backfill — jurisdiction is
   *  already complete on all 221 projects, so nobody should count it as a win.
   *  `NOT NULL` in the database, so it cannot be cleared. */
  juris?: string | null;
  unit_types?: UnitType[] | null;
}

/** ★★★ THE WHITELIST, AS A VALUE. The hook builds the jsonb patch from this
 *  list rather than from `Object.keys(patch)`, so a caller that hands over an
 *  unexpected key gets it dropped in the browser instead of a `42601` from the
 *  server — and the list is the same one the function checks. */
export const LIBRARY_PATCH_FIELDS = [
  'zone',
  'alley',
  'lot_width',
  'lot_depth',
  'lot_size_sf',
  'is_corner_lot',
  'juris',
  'unit_types',
] as const satisfies readonly (keyof LibraryFieldPatch)[];

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
      // ★★★ fix-562 §G — KEY PRESENCE IS THE WHOLE CONTRACT. A key the caller
      //     did not supply must NOT appear in the jsonb, or the column is
      //     written to null; a key the caller supplied AS null must appear, or
      //     the field cannot be cleared. `in` is the test, never `?? null`,
      //     which is what collapsed the two cases before this ticket.
      const p_patch: Record<string, unknown> = {};
      for (const k of LIBRARY_PATCH_FIELDS) {
        const v = input.patch[k];
        // ★ `undefined` is "leave alone" and `null` is "clear" — the two are
        //   different instructions and `?? null` would merge them, which is the
        //   exact conflation this ticket is removing from the server.
        if (v !== undefined) p_patch[k] = v;
      }
      const { data, error } = await supabase.rpc('bp_update_library_fields', {
        p_project_id: input.projectId,
        p_expected_updated_at: expected,
        p_patch,
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
