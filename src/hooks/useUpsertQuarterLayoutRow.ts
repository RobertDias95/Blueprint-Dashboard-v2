import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleQuarterLayoutRow } from '../lib/database.types';

// fix-182b: bp_upsert_quarter_layout_row. INSERT a new column or UPDATE an
// existing one with OCC. Mirrors useUpsertDmDaGroup's shape. The RPC replaces
// every editable field, so an update sends the full current row merged with the
// patch.

type EditableCol = Pick<
  DrawScheduleQuarterLayoutRow,
  'quarter' | 'position' | 'col_kind' | 'da_name' | 'group_label' | 'label_override'
>;

export type UpsertQuarterLayoutInput =
  | { op: 'insert'; data: EditableCol }
  | {
      op: 'update';
      row: DrawScheduleQuarterLayoutRow;
      patch: Partial<EditableCol>;
    };

interface Row {
  out_id: string;
  updated_at: string;
  conflict: boolean;
}

export function useUpsertQuarterLayoutRow() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<
    { id: string; updated_at: string; quarter: string },
    Error,
    UpsertQuarterLayoutInput
  >({
    mutationFn: async (input) => {
      const isInsert = input.op === 'insert';
      const payload: EditableCol = isInsert
        ? input.data
        : {
            quarter: input.row.quarter,
            position: input.row.position,
            col_kind: input.row.col_kind,
            da_name: input.row.da_name,
            group_label: input.row.group_label,
            label_override: input.row.label_override,
            ...input.patch,
          };
      const { data, error } = await supabase.rpc('bp_upsert_quarter_layout_row', {
        p_id: isInsert ? null : input.row.id,
        p_data: payload,
        p_expected_updated_at: isInsert ? null : input.row.updated_at,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Upsert returned no row');
      if (row.conflict) throw new OCCConflictError(0, 'Quarter layout');
      return { id: row.out_id, updated_at: row.updated_at, quarter: payload.quarter };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawScheduleQuarterLayout(tenantId, res.quarter),
      });
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(
          'Layout was modified by someone else — refresh and retry',
          'warn',
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.drawScheduleQuarterLayoutAll,
        });
      } else {
        pushToast(`Could not save layout — ${error.message}`, 'error');
      }
    },
  });
}
