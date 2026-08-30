import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// ★★★ fix-457 §A6 (P-007) — THE WRITE SIDE da_team_routing NEVER HAD.
//
// fix-72 built the table in May and gave it four RLS policies and no editor, so
// every routing change since has been a hand-written INSERT. This is fix-436's
// "Bobby can add a person without Claude" finished for the other half of
// onboarding.
//
// ★★ THE SHAPE IS COPIED FROM useUpsertDmDaGroup / useDeleteDmDaGroup, the
// other DA mapping table edited from Settings → Team (STEP 0d): an OCC-guarded
// RPC pair that returns `conflict` as a VALUE rather than raising, which the
// hook turns into an OCCConflictError. Not a third pattern.

interface UpsertRow {
  out_id: number;
  updated_at: string;
  conflict: boolean;
}

interface DeleteRow {
  deleted: boolean;
  conflict: boolean;
  current_updated_at: string | null;
}

/** The editable fields of one routing rule. `jurisdiction: null` IS the
 *  default rule — the one that applies wherever no specific rule exists. */
export interface DaRoutingPatch {
  da: string;
  jurisdiction: string | null;
  ent_lead: string;
}

export type UpsertDaRoutingInput =
  | { op: 'insert'; patch: DaRoutingPatch }
  | { op: 'update'; id: number; updated_at: string; patch: DaRoutingPatch };

export function useUpsertDaRouting() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<{ id: number; updated_at: string }, Error, UpsertDaRoutingInput>({
    mutationFn: async (input) => {
      const isInsert = input.op === 'insert';
      const { data, error } = await supabase.rpc(
        'bp_upsert_da_team_routing_row',
        {
          p_id: isInsert ? null : input.id,
          p_data: {
            da: input.patch.da,
            // ★ The RPC maps '' to NULL itself, so a blank select and a missing
            //   key mean the same thing on both sides of the wire.
            jurisdiction: input.patch.jurisdiction ?? '',
            ent_lead: input.patch.ent_lead,
          },
          p_expected_updated_at: isInsert ? null : input.updated_at,
        },
      );
      if (error) throw error;
      const row = (data as UpsertRow[])[0];
      if (!row) throw new Error('Upsert returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'DA routing');
      return { id: row.out_id, updated_at: row.updated_at };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.daTeamRouting(tenantId) });
      pushToast('Saved DA routing', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.daTeamRouting(tenantId) });
      } else {
        // ★ The RPC's duplicate guard raises a sentence ("Ainsley already has a
        //   default rule"), so passing the message through is the whole error
        //   experience — no client-side re-wording.
        pushToast(`Could not save DA routing — ${error.message}`, 'error');
      }
    },
  });
}

export function useDeleteDaRouting() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: number; updated_at: string }>({
    mutationFn: async ({ id, updated_at }) => {
      const { data, error } = await supabase.rpc(
        'bp_delete_da_team_routing_row',
        { p_id: id, p_expected_updated_at: updated_at },
      );
      if (error) throw error;
      const row = (data as DeleteRow[])[0];
      if (row?.conflict) throw new OCCConflictError(0, 'DA routing');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.daTeamRouting(tenantId) });
      pushToast('Removed routing rule', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.daTeamRouting(tenantId) });
      } else {
        pushToast(`Could not remove rule — ${error.message}`, 'error');
      }
    },
  });
}
