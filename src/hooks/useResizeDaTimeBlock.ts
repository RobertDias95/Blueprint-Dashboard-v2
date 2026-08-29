import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { applyResizedBlock } from '../lib/daTimeBlockCache';

// fix-25-feat-a: bp_resize_da_time_block. Atomic, overlap-aware resize
// for da_time_blocks (NP / vacation / training / corrections rows).
// Mirrors the fix-25h response shape — a conflict surfaces as
// out_overlap_kind ('project' | 'np') + overlapConflicts + proposed
// weeks, rather than an exception. Caller opens the conflict prompt
// and re-fires with force=true on "Save anyway".

export type NpResizeProjectConflict = {
  project_id: string;
  address: string;
  start_week: string;
  end_week: string;
};

export type NpResizeNpConflict = {
  id: string;
  type: string;
  label: string | null;
  start_week: string;
  end_week: string;
};

export interface ResizeDaTimeBlockInput {
  /** NP block id (text PK, e.g. "np_<ts>_<rand>"). */
  blockId: string;
  newStartWeek: string;
  newEndWeek: string;
  /** Current updated_at of the row — captured at resize-start for OCC. */
  expectedUpdatedAt: string;
  /** When true, the RPC skips overlap detection. Set after the user
   *  confirms "Save anyway" on NpResizeConflictPrompt. */
  force?: boolean;
}

interface RpcRow {
  out_id: string;
  out_updated_at: string | null;
  out_conflict: boolean;
  out_overlap_kind: 'project' | 'np' | null;
  out_overlap_conflicts:
    | NpResizeProjectConflict[]
    | NpResizeNpConflict[]
    | null;
  out_proposed_start_week: string | null;
  out_proposed_end_week: string | null;
}

export interface ResizeDaTimeBlockResult {
  blockId: string;
  updatedAt: string | null;
  /** When set, the RPC did NOT write — caller surfaces the prompt. */
  overlapKind: 'project' | 'np' | null;
  overlapConflicts:
    | NpResizeProjectConflict[]
    | NpResizeNpConflict[]
    | null;
  proposedStartWeek: string | null;
  proposedEndWeek: string | null;
}

export function useResizeDaTimeBlock() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<ResizeDaTimeBlockResult, Error, ResizeDaTimeBlockInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_resize_da_time_block', {
        p_id: input.blockId,
        p_new_start_week: input.newStartWeek,
        p_new_end_week: input.newEndWeek,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_force: input.force ?? false,
      });
      if (error) throw error;
      const row = (data as RpcRow[])[0];
      if (!row) throw new Error('Resize RPC returned no row');
      if (row.out_conflict) {
        throw new OCCConflictError(0, 'Time block');
      }
      return {
        blockId: row.out_id,
        updatedAt: row.out_updated_at,
        overlapKind: row.out_overlap_kind,
        overlapConflicts: row.out_overlap_conflicts,
        proposedStartWeek: row.out_proposed_start_week,
        proposedEndWeek: row.out_proposed_end_week,
      };
    },

    onSuccess: (result, input) => {
      // Overlap responses are NOT writes — caller handles via prompt.
      if (result.overlapKind) return;
      // ★★★ fix-442 (P-067): WRITE THE NEW TOKEN BACK BEFORE INVALIDATING.
      //
      // The grid reads `expectedUpdatedAt` straight off the rendered row (the
      // two resize handles, ~1911 and ~1950). Until this line existed, the row
      // kept its PRE-write `updated_at` for as long as the refetch took, so a
      // second drag 1.5 s later handed the server a superseded token and the
      // OCC guard — correctly — refused it. Six prod reports, all "Time block",
      // all one person editing their own block twice.
      //
      // ★ It runs for the force=true retry path too: `force` only skips the
      //   RPC's OVERLAP check, never its OCC check, so the retry mints a new
      //   token exactly like the first attempt and the cache must learn it.
      applyResizedBlock(
        queryClient,
        tenantId,
        result.blockId,
        input.newStartWeek,
        input.newEndWeek,
        result.updatedAt,
      );
      // ★ …and STILL invalidate. The write-back fixes the token; the refetch
      //   is what reconciles everything else the RPC may have moved.
      queryClient.invalidateQueries({
        queryKey: queryKeys.daTimeBlocks(tenantId),
      });
      pushToast('Resized time block', 'success');
    },

    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(
          'Time block changed since you loaded it — refresh and retry',
          'warn',
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.daTimeBlocks(tenantId),
        });
      } else {
        pushToast(`Could not resize block — ${error.message}`, 'error');
      }
    },
  });
}
