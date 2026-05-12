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
      const { data, error } = await supabase
        .from('projects')
        .select(
          'id, address, juris, archived, notes, external_team, builder_id, permit_order, created_at, updated_at',
        )
        .eq('archived', false)
        .order('address', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });
}
