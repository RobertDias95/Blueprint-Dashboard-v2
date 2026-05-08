import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import type { PermitTask } from '../lib/database.types';

// Q4: Tasks for a single permit, ordered by sort_order then created_at.
// Separate from usePermitsByProject so cycle changes (high-traffic) don't
// invalidate the task cache and vice versa.

export function usePermitTasks(permitId: number | undefined) {
  return useQuery<PermitTask[]>({
    queryKey: queryKeys.permitTasksFor(permitId ?? 0),
    enabled: typeof permitId === 'number' && permitId > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_tasks')
        .select('*')
        .eq('permit_id', permitId!)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PermitTask[];
    },
  });
}
