import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Permit } from '../lib/database.types';

// fix-36: atomic Project Settings save. Replaces the modal's sequential
// updateProject + per-permit update/create/delete loop (which reused
// modal-open OCC tokens across N round-trips and lost the race to the engine
// cascade's realtime invalidation). One RPC = one transaction with per-row
// OCC checks; the client-side multi-write window is gone. The RPC returns a
// structured conflict (not an error) when a token is stale, so the modal can
// keep itself open and prompt a reload.
//
// target_submit is ENGINE-owned and is intentionally NOT part of the permit
// payload (the RPC strips it defensively too).

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
      queryClient.invalidateQueries({ queryKey: queryKeys.projects(tenantId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitsByProject(tenantId, input.projectId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
    },

    onError: (error) => {
      pushToast(`Could not save project settings — ${error.message}`, 'error');
    },
  });
}
