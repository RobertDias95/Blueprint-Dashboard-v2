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
