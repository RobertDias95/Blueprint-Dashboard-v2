import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import type { PermitWithCycles } from '../lib/database.types';

// Q2: Single project's permits + cycles. Used by the project detail page.
// `enabled` guards against firing the query before the route param resolves.

export function usePermitsByProject(projectId: string | undefined) {
  return useQuery<PermitWithCycles[]>({
    queryKey: queryKeys.permitsByProject(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permits')
        .select('*, permit_cycles(*)')
        .eq('project_id', projectId!)
        .order('id', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PermitWithCycles[];
    },
  });
}
