import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';

// Q2: All non-archived projects, ordered by address. The matrix view, the
// project list, and the project detail breadcrumb all consume this.
//
// Q5.5.D: tenant-scoped via RLS. Cache key includes activeTenantId so a
// future tenant-switch invalidates cleanly.

export function useProjects() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Project[]>({
    queryKey: queryKeys.projects(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      // fix-22-final / Mig 6 read-surface sweep: explicitly list the 13
      // project-level columns added in Migrations 1+6 (entitlement_lead,
      // design_manager, go_date, units, zone, lot_width, lot_depth,
      // unit_types, parking_type, parking_stalls, alley, product_type,
      // project_tags, builder_name, builder_company, builder_email,
      // builder_phone) so Project Overview + Library + Reports can
      // read them. Without these listed, the wizard wrote to projects.*
      // but every read surface saw blanks.
      const { data, error } = await supabase
        .from('projects')
        .select(
          [
            'id, address, juris, archived, notes',
            'acq_lead, external_team, builder_id, permit_order',
            'entitlement_lead, design_manager, go_date',
            'units, zone, lot_width, lot_depth, unit_types',
            'parking_type, parking_stalls, alley, product_type, project_tags',
            'builder_name, builder_company, builder_email, builder_phone',
            'created_at, updated_at',
          ].join(', '),
        )
        .eq('archived', false)
        .order('address', { ascending: true });
      if (error) throw error;
      // PostgREST's inferred union doesn't unify with Project when the
      // select list is long. Cast via unknown — columns match the
      // hand-typed interface exactly.
      return (data ?? []) as unknown as Project[];
    },
  });
}
