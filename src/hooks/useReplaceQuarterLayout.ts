import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { DrawScheduleQuarterLayoutRow } from '../lib/database.types';

// fix-190c: atomic "save the whole quarter layout" path. The editor buffers all
// edits in a local draft and calls this once on Save — bp_replace_quarter_layout
// deletes the quarter's rows and re-inserts the draft in order (positions
// 0..n-1) in one transaction. Replaces the per-row write hooks the editor used
// to fire on every keystroke / drag (those still exist for any other caller).

/** The column fields persisted per row; position is the array index (server). */
export type ReplaceColumn = Pick<
  DrawScheduleQuarterLayoutRow,
  'col_kind' | 'da_name' | 'group_label' | 'label_override' | 'top_label'
>;

export interface ReplaceQuarterLayoutInput {
  quarter: string;
  rows: ReplaceColumn[];
  /** max(updated_at) of the rows the editor loaded, or null when it loaded an
   *  empty quarter (skip the OCC check). Compared server-side as a timestamptz. */
  expectedFingerprint: string | null;
}

/** Postgres SQLSTATE 40001 = the quarter changed since the editor loaded it.
 *  The editor surfaces a "changed elsewhere — reload" warning instead of
 *  clobbering the concurrent change. */
export function isReplaceConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '40001'
  );
}

/** max(updated_at) over the loaded rows — the OCC fingerprint the editor sends
 *  back on Save. ISO strings sort chronologically, so a lexical max is the
 *  newest. null for an empty quarter (no baseline). */
export function layoutFingerprint(
  rows: Pick<DrawScheduleQuarterLayoutRow, 'updated_at'>[],
): string | null {
  if (rows.length === 0) return null;
  let max = rows[0].updated_at;
  for (const r of rows) if (r.updated_at > max) max = r.updated_at;
  return max;
}

export function useReplaceQuarterLayout() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<number, Error, ReplaceQuarterLayoutInput>({
    mutationFn: async ({ quarter, rows, expectedFingerprint }) => {
      const { data, error } = await supabase.rpc('bp_replace_quarter_layout', {
        p_quarter: quarter,
        p_rows: rows,
        p_expected_fingerprint: expectedFingerprint,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (_count, { quarter }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.drawScheduleQuarterLayout(tenantId, quarter),
      });
    },
    // Toasts are left to the caller so it can distinguish the conflict-reload
    // path from a generic failure.
  });
}
