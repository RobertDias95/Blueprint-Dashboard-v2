import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { REALTIME_TABLES } from '../lib/queryKeys';

// Q2: Single Realtime channel that listens to changes on all six tables
// and invalidates the matching TanStack Query keys. Architectural primitive
// #3: realtime is the canonical sync. Realtime → invalidate → refetch.
//
// Mounted once at the app root (App.tsx). Tearing down the channel on
// unmount is important because Supabase's per-connection limit is real.

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let channel = supabase.channel('bp-v2-realtime');

    (Object.keys(REALTIME_TABLES) as (keyof typeof REALTIME_TABLES)[]).forEach(
      (table) => {
        const keys = REALTIME_TABLES[table];
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          () => {
            // fix-39 Track B: don't invalidate (→ refetch) while a mutation is
            // in flight. A realtime event landing mid-mutation would refetch
            // the pre-commit row and clobber the optimistic edit — the silent
            // "approval_date goes blank" race. The mutation's own onSuccess
            // merges the authoritative row; the next realtime event (after the
            // mutation settles) re-syncs everything else.
            if (queryClient.isMutating() > 0) return;
            keys.forEach((key) => {
              queryClient.invalidateQueries({ queryKey: key });
            });
          },
        );
      },
    );

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
