import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import type { Project } from '../lib/database.types';

// Q2: All non-archived projects, ordered by address. The matrix view, the
// project list, and the project detail breadcrumb all consume this.

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: queryKeys.projects,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(
          'id, address, juris, archived, notes, created_at, updated_at',
        )
        .eq('archived', false)
        .order('address', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });
}
