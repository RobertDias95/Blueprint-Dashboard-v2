import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleQuarterLayoutRow } from '../lib/database.types';

// fix-182d: collision-proof column inserts for the layout editor. The position
// is ALWAYS decided server-side (bp_append_quarter_layout_column =
// max(position)+1; bp_insert_quarter_layout_column = shift-then-insert), never
// from client state — this is the real guard against the rapid-double-add
// duplicate-key error. The editor also disables the add controls while a
// mutation is pending (defense-in-depth).

/** The column fields; position is never sent (server-assigned). */
export type NewColumn = Pick<
  DrawScheduleQuarterLayoutRow,
  'col_kind' | 'da_name' | 'group_label' | 'label_override'
> &
  // fix-190b: top_label optional on new columns (default no top header).
  Partial<Pick<DrawScheduleQuarterLayoutRow, 'top_label'>>;

function colPayload(col: NewColumn) {
  return {
    col_kind: col.col_kind,
    da_name: col.da_name,
    group_label: col.group_label,
    label_override: col.label_override,
    top_label: col.top_label ?? null,
  };
}

/** Append a column at the end (server-computed next position). */
export function useAppendQuarterLayoutColumn() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<number, Error, { quarter: string; col: NewColumn }>({
    mutationFn: async ({ quarter, col }) => {
      const { data, error } = await supabase.rpc(
        'bp_append_quarter_layout_column',
        { p_quarter: quarter, p_col: colPayload(col) },
      );
      if (error) throw error;
      const row = (data as { out_position: number }[])[0];
      return row?.out_position ?? 0;
    },
    onSuccess: (_pos, { quarter }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawScheduleQuarterLayout(tenantId, quarter),
      });
    },
    onError: (error) => {
      pushToast(`Could not add column — ${error.message}`, 'error');
    },
  });
}

/** Insert a column at an explicit position (shift-then-insert, atomic). */
export function useInsertQuarterLayoutColumn() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<
    number,
    Error,
    { quarter: string; atPosition: number; col: NewColumn }
  >({
    mutationFn: async ({ quarter, atPosition, col }) => {
      const { data, error } = await supabase.rpc(
        'bp_insert_quarter_layout_column',
        { p_quarter: quarter, p_at_position: atPosition, p_col: colPayload(col) },
      );
      if (error) throw error;
      const row = (data as { out_position: number }[])[0];
      return row?.out_position ?? 0;
    },
    onSuccess: (_pos, { quarter }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawScheduleQuarterLayout(tenantId, quarter),
      });
    },
    onError: (error) => {
      pushToast(`Could not insert column — ${error.message}`, 'error');
    },
  });
}
