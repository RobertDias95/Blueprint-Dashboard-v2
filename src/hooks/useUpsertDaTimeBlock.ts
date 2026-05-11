import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { DaTimeBlock } from '../lib/database.types';

// Q6.2.f: row-level OCC upsert for da_time_blocks via the Q7.3.0 RPC
// bp_upsert_da_time_block_row. The table's PK is text (client-generated
// id `np_<timestamp>_<random>` mirroring v1's id pattern). Pass
// p_expected_updated_at=null for INSERTs, the row's current updated_at
// for UPDATEs.

type EditableField =
  | 'da_name'
  | 'type'
  | 'label'
  | 'start_week'
  | 'end_week';
export type DaTimeBlockPatch = Partial<Pick<DaTimeBlock, EditableField>>;

export type UpsertDaTimeBlockInput =
  | {
      op: 'insert';
      id: string;
      patch: DaTimeBlockPatch & {
        da_name: string;
        type: string;
        start_week: string;
        end_week: string;
      };
    }
  | { op: 'update'; block: DaTimeBlock; patch: DaTimeBlockPatch };

interface Row {
  out_id: string;
  updated_at: string;
  conflict: boolean;
}

function buildPayload(
  base: Partial<DaTimeBlock>,
  patch: DaTimeBlockPatch,
): Record<string, string | null> {
  const merged = { ...base, ...patch };
  return {
    da_name: merged.da_name ?? '',
    type: merged.type ?? '',
    label: merged.label ?? null,
    start_week: merged.start_week ?? '',
    end_week: merged.end_week ?? '',
  };
}

export function useUpsertDaTimeBlock() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<DaTimeBlock, Error, UpsertDaTimeBlockInput>({
    mutationFn: async (input) => {
      const isInsert = input.op === 'insert';
      const payload = isInsert
        ? buildPayload({}, input.patch)
        : buildPayload(input.block, input.patch);
      const { data, error } = await supabase.rpc(
        'bp_upsert_da_time_block_row',
        {
          p_id: isInsert ? input.id : input.block.id,
          p_data: payload,
          p_expected_updated_at: isInsert ? null : input.block.updated_at,
        },
      );
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Upsert returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Time block');
      return {
        id: row.out_id,
        da_name: payload.da_name as string,
        type: payload.type as string,
        label: payload.label as string | null,
        start_week: payload.start_week as string,
        end_week: payload.end_week as string,
        created_at: isInsert ? row.updated_at : (input.block.created_at ?? null),
        updated_at: row.updated_at,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.daTimeBlocks(tenantId) });
      pushToast('Saved time block', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.daTimeBlocks(tenantId),
        });
      } else {
        pushToast(`Could not save block — ${error.message}`, 'error');
      }
    },
  });
}
