import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type { Project } from '../lib/database.types';

// fix-146: fetch the parent project's primary Building Permit for a
// reuse-redesign. The redesign shares the original's permit (it created none of
// its own), so the redesign editor surfaces that permit's *application* status
// (permits.status — e.g. "Pre-Submittal — GO") as a read-only inherited line,
// distinct from the editable draw_schedule lane status. Gated on reuse=true +
// a parent FK so non-redesign projects never run the query.

export interface InheritedPermit {
  id: number;
  type: string;
  status: string | null;
  updated_at: string;
}

export function useOriginalPermitForRedesign(project: Project) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const enabled =
    !!project.redesign_of_project_id &&
    project.redesign_reuses_original_permit === true &&
    !!tenantId;

  return useQuery<InheritedPermit | null>({
    queryKey: [
      'permits',
      tenantId ?? '',
      'inherited',
      project.redesign_of_project_id,
    ],
    enabled,
    staleTime: 30_000, // permit status changes infrequently; light caching is fine
    queryFn: async (): Promise<InheritedPermit | null> => {
      const { data, error } = await supabase
        .from('permits')
        .select('id,type,status,updated_at')
        .eq('project_id', project.redesign_of_project_id!)
        .eq('type', 'Building Permit')
        .order('id', { ascending: true }) // first BP — deterministic on multi-BP
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return data as InheritedPermit;
    },
  });
}
