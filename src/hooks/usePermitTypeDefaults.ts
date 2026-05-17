import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { PermitTypeDefault } from '../lib/database.types';

// fix-25-feat-Z: read tenant-scoped permit_type_defaults. Replaces the
// hardcoded PER_TYPE_DEFAULT_DAYS lookup for the schedule estimator's
// "no learner samples available" fallback path.
//
// Returns:
//   rows  — raw array (one per type the tenant has overridden)
//   byType — Map<type, intake_to_approval_days> for fast lookup;
//            consumers pass this to defaultDaysForType(type, byType).
//   c1OffsetByType — Map<type, c1_resub_offset_days> (nulls excluded
//            so callers can short-circuit when no override exists).
//
// RLS handles the tenant filter; the auth context determines visibility.

export interface PermitTypeDefaultsResult {
  rows: PermitTypeDefault[];
  byType: Map<string, number>;
  c1OffsetByType: Map<string, number>;
}

export function usePermitTypeDefaults() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<PermitTypeDefault[]>({
    queryKey: queryKeys.permitTypeDefaults(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_type_defaults')
        .select('type, intake_to_approval_days, c1_resub_offset_days, updated_at')
        .order('type', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PermitTypeDefault[];
    },
  });

  const derived = useMemo<PermitTypeDefaultsResult>(() => {
    const rows = q.data ?? [];
    const byType = new Map<string, number>();
    const c1OffsetByType = new Map<string, number>();
    for (const r of rows) {
      byType.set(r.type, r.intake_to_approval_days);
      if (r.c1_resub_offset_days != null) {
        c1OffsetByType.set(r.type, r.c1_resub_offset_days);
      }
    }
    return { rows, byType, c1OffsetByType };
  }, [q.data]);

  return { ...q, ...derived };
}
