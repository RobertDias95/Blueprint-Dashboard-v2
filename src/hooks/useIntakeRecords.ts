import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import type { IntakeRecord } from '../lib/database.types';

// Q2: Seattle intake records. Q7 builds the full intake tracker view; Q2
// just exposes the read so the Settings → Seattle Intakes tab can show
// row count and a placeholder list.

export function useIntakeRecords() {
  return useQuery<IntakeRecord[]>({
    queryKey: queryKeys.intakeRecords,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('intake_records')
        .select('*')
        .order('intake_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as IntakeRecord[];
    },
  });
}
