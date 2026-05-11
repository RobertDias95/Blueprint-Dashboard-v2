import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { IntakeRecord } from '../lib/database.types';

// Q2: Seattle intake records. Q7 builds the full intake tracker view; Q2
// just exposes the read so the Settings → Seattle Intakes tab can show
// row count and a placeholder list.

export function useIntakeRecords() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<IntakeRecord[]>({
    queryKey: queryKeys.intakeRecords(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('intake_records')
        .select(
          'id, project_id, permit_id, address, permit_num, permit_type, ' +
            'intake_date, is_placeholder, portal_url, link, ' +
            'created_at, updated_at',
        )
        .order('intake_date', { ascending: false });
      if (error) throw error;
      // PostgREST infers a column-string-based shape from the select that
      // doesn't unify with IntakeRecord (no generated types in this repo).
      // Cast via unknown — the columns selected match the interface exactly.
      return (data ?? []) as unknown as IntakeRecord[];
    },
  });
}
