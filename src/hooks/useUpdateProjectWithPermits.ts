import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Permit, PermitWithCycles, Project } from '../lib/database.types';

// fix-36: atomic Project Settings save. Replaces the modal's sequential
// updateProject + per-permit update/create/delete loop (which reused
// modal-open OCC tokens across N round-trips and lost the race to the engine
// cascade's realtime invalidation). One RPC = one transaction with per-row
// OCC checks; the client-side multi-write window is gone. The RPC returns a
// structured conflict (not an error) when a token is stale, so the modal can
// keep itself open and prompt a reload.
//
// target_submit was originally ENGINE-owned and excluded from the payload.
// fix-66 (2026-05-28): it's now an OPTIONAL permit_upsert field so the DD
// Phase cell on Project Overview can edit the BP-anchored projected submit
// date in place. The DB trigger bp_trg_set_target_submit_manual_flag flips
// target_submit_is_manual on a direct write, so callers send only
// target_submit and never the flag. The engine recompute path
// (bp_recompute_target_submits) still owns the non-manual recomputation.

/** One element of p_permit_upserts. An `id` (+ expected_updated_at) marks an
 *  existing permit to OCC-update; its absence marks a new permit to insert. */
export interface PermitUpsertInput {
  id?: number;
  expected_updated_at?: string;
  type?: string;
  ent_lead?: string | null;
  da?: string | null;
  portal_url?: string | null;
  num?: string | null;
  struct_address?: string | null;
  expected_issue?: string | null;
  /**
   * ★★★ fix-517 §E — `Sub-permit of`, MOVED OFF THE DELETED QUICK EDIT MODAL.
   *
   * fix-194's marker: a permit with `parent_permit_id` set is a placeholder
   * reviewed under its parent, excluded from every rollup. It had exactly one
   * editor — `QuickEditPermitModal` — and §E deletes that modal, so the field
   * moves into the same atomic save as the row's type, ENT and DA rather than
   * becoming uneditable. **3 of 685 prod permits are sub-permits**, so it is
   * cheap; dropping it silently is what §E forbids.
   *
   * ★ `null` CLEARS the link. The RPC validates that the id names a permit on
   *   the same project and is not the row itself.
   */
  parent_permit_id?: number | null;
  /** fix-66: engine-derived projected submit date, now editable in place
   *  from the DD Phase cell (BP-anchored). The RPC whitelists this in both
   *  the update + insert branches; the bp_trg_set_target_submit_manual_flag
   *  trigger sets target_submit_is_manual automatically, so callers MUST
   *  NOT pass that flag. '' / null clears the column. */
  target_submit?: string | null;
}

export interface UpdateProjectWithPermitsInput {
  projectId: string;
  projectExpectedUpdatedAt: string;
  /** Project fields to write, or {} to leave the project row untouched. */
  projectPatch: Partial<Permit> | Record<string, unknown>;
  permitUpserts: PermitUpsertInput[];
  permitDeletes: number[];
}

export interface UpdateProjectWithPermitsResult {
  conflict: boolean;
  conflictKind: 'project' | 'permit' | null;
  conflictId: string | null;
  projectUpdatedAt: string | null;
  permits: { id: number; updated_at: string }[];
}

interface RpcRow {
  out_conflict: boolean;
  out_conflict_kind: 'project' | 'permit' | null;
  out_conflict_id: string | null;
  out_project_updated_at: string | null;
  out_permits: { id: number; updated_at: string }[] | null;
}

export function useUpdateProjectWithPermits() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<
    UpdateProjectWithPermitsResult,
    Error,
    UpdateProjectWithPermitsInput
  >({
    // ★ fix-511 §C: the settings modal's atomic save — the second
    //   `lot_size_sf` write path.
    meta: { write: 'bp_update_project_with_permits' },
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_update_project_with_permits',
        {
          p_project_id: input.projectId,
          p_project_expected_updated_at: input.projectExpectedUpdatedAt,
          p_project_patch: input.projectPatch,
          p_permit_upserts: input.permitUpserts,
          p_permit_deletes: input.permitDeletes,
        },
      );
      if (error) throw error;
      const row = (data as RpcRow[] | null)?.[0];
      if (!row) {
        throw new Error('bp_update_project_with_permits returned no row');
      }
      return {
        conflict: row.out_conflict,
        conflictKind: row.out_conflict_kind,
        conflictId: row.out_conflict_id,
        projectUpdatedAt: row.out_project_updated_at,
        permits: row.out_permits ?? [],
      };
    },

    onSuccess: (result, input) => {
      // Conflict is a normal (non-error) return — the whole edit rolled back
      // server-side, so leave the caches alone and let the modal prompt a
      // reload. Only refresh on a real success.
      if (result.conflict) return;

      // fix-73: write each returned permit's fresh updated_at + the project's
      // new updated_at SYNCHRONOUSLY into the caches. Without this, a follow-up
      // edit on the same row in the window before invalidate's refetch lands
      // captures the stale OCC token and OCC-conflicts (Bobby's repro on the
      // Project Settings save → next inline edit). Mirrors the Bug-B-fix
      // pattern from useUpdateDrawSchedule.
      if (result.permits.length > 0) {
        const byId = new Map(result.permits.map((p) => [p.id, p.updated_at]));
        const patchPermits = (rows: PermitWithCycles[] | undefined) =>
          rows?.map((p) =>
            byId.has(p.id) ? { ...p, updated_at: byId.get(p.id) as string } : p,
          );
        queryClient.setQueryData<PermitWithCycles[]>(
          queryKeys.permits(tenantId),
          (rows) => patchPermits(rows),
        );
        queryClient.setQueryData<PermitWithCycles[]>(
          queryKeys.permitsByProject(tenantId, input.projectId),
          (rows) => patchPermits(rows),
        );
      }
      if (result.projectUpdatedAt) {
        const projectUpdatedAt = result.projectUpdatedAt;
        queryClient.setQueryData<Project[]>(
          queryKeys.projects(tenantId),
          (rows) =>
            rows?.map((p) =>
              p.id === input.projectId
                ? { ...p, updated_at: projectUpdatedAt }
                : p,
            ),
        );
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.projects(tenantId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitsByProject(tenantId, input.projectId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
    },

    onError: (error) => {
      pushToast(`Could not save project details — ${error.message}`, 'error');
    },
  });
}
