import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type { JurisPermitStat } from '../lib/database.types';

// fix-22: per-juris permit-usage stats via bp_get_juris_permit_stats RPC.
// The matview behind the RPC is tenant-scoped (RLS); the RPC adds
// "show % only when N>=5" via usage_pct_display being NULL for small N.
//
// Wizard Step 2 uses these to bucket the permit catalog into
// Commonly (>=50%) / Sometimes (5–50%) / Other. When stats is empty
// (juris not in the matview yet) the caller should fall back to a flat
// catalog with just Building Permit pre-checked.

export function useJurisPermitStats(juris: string | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const normalized = (juris ?? '').trim();
  return useQuery<JurisPermitStat[]>({
    // Bare prefix included so a (very rare) matview refresh can invalidate
    // the whole namespace at once if needed later.
    queryKey: ['juris_permit_stats', tenantId ?? '', normalized],
    enabled: !!tenantId && normalized.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'bp_get_juris_permit_stats',
        { p_juris: normalized },
      );
      if (error) throw error;
      return (data ?? []) as unknown as JurisPermitStat[];
    },
  });
}
