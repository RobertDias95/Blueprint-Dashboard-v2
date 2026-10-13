import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// fix-288: bp_rename_permit_type.
//
// ★ WHY A DEDICATED RPC RATHER THAN upsert-new + delete-old. The catalogue is
// joined to permits BY STRING — permits.type holds 'Building Permit', not a
// foreign key. Renaming client-side would leave every permit carrying the OLD
// string and pointing at a catalogue row that no longer exists. 143 permits say
// 'Building Permit'. The RPC moves the catalogue row and every referencing
// permit in ONE transaction, and returns how many permits it repointed so the
// UI can say what actually happened.
//
// Renaming onto a name that already exists is refused server-side rather than
// silently merging two types (and all their permits) into one.

interface Row {
  out_name: string;
  out_permits_repointed: number;
  /** ★ fix-660: rows moved per place. Absent before the migration ran. */
  out_writes?: Record<string, number> | null;
}

/** ★ fix-660: the places a rename moves, in the words the toast uses. Keys are
 *  bp_rename_permit_type's `out_writes`. */
const WRITE_LABEL: Record<string, [string, string]> = {
  task_templates: ['task template', 'task templates'],
  target_submit_formulas: ['target-submit formula', 'target-submit formulas'],
  permit_type_defaults: ['default', 'defaults'],
  permit_type_descriptions: ['description', 'descriptions'],
  intake_records: ['intake record', 'intake records'],
};

/** "4 permits, 1 task template, 1 target-submit formula" — every place that
 *  moved, in a fixed order, skipping zeroes. Exported for tests. */
export function describeRenameWrites(row: Row): string {
  const n = row.out_permits_repointed;
  const parts: string[] = [];
  if (n > 0) parts.push(`${n} permit${n === 1 ? '' : 's'}`);
  for (const [key, [one, many]] of Object.entries(WRITE_LABEL)) {
    const c = row.out_writes?.[key] ?? 0;
    if (c > 0) parts.push(`${c} ${c === 1 ? one : many}`);
  }
  return parts.join(', ');
}

export function useRenamePermitType() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<Row, Error, { from: string; to: string }>({
    meta: { write: 'bp_rename_permit_type' },
    mutationFn: async ({ from, to }) => {
      const { data, error } = await supabase.rpc('bp_rename_permit_type', {
        p_old: from,
        p_new: to,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Rename returned no row');
      return row;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTypes(tenantId) });
      // The permits themselves moved, so anything reading permits.type is stale.
      queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
      // ★ fix-660: and so did every other place that stores the name.
      queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplatesAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.targetSubmitFormulasAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTypeDefaultsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.appConfigAll });
      const moved = describeRenameWrites(row);
      pushToast(
        moved === ''
          ? `Renamed to ${row.out_name}`
          : `Renamed to ${row.out_name} — ${moved} updated`,
        'success',
      );
    },
    onError: (error) => {
      // ★ fix-660: a refusal carries its reason ("…is named in the database's
      //   own rules (…)"); show it without the function-name prefix.
      pushToast(
        `Could not rename permit type — ${error.message.replace(/^bp_rename_permit_type:\s*/, '')}`,
        'error',
      );
    },
  });
}
