import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

// fix-144: lookahead wrapper over bp_next_available_da_slot. The redesign DD
// phase's auto-place mode uses it to suggest the next open slot on the picked
// DA's lane (the same RPC bp_create_project_with_permits uses server-side, so
// the suggestion matches what would land). slot_start is already Monday and
// slot_end Friday post-fix-141; the caller snaps defensively anyway.

export interface DaSlotSuggestion {
  /** ISO YYYY-MM-DD — Monday start of the suggested slot. */
  slotStart: string;
  /** ISO YYYY-MM-DD — Friday end of the suggested slot. */
  slotEnd: string;
}

interface SlotRow {
  slot_start: string;
  slot_end: string;
}

/** Suggest the next open slot on `daName`'s lane. Disabled (no fetch) when
 *  `enabled` is false or `daName` is blank. */
export function useNextAvailableDaSlot(
  daName: string,
  durationDays: number,
  enabled: boolean,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<DaSlotSuggestion | null>({
    queryKey: ['nextAvailableDaSlot', tenantId ?? '', daName, durationDays],
    enabled: enabled && !!daName && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_next_available_da_slot', {
        p_da_name: daName,
        p_duration_days: durationDays,
      });
      if (error) throw error;
      const row = (data as SlotRow[] | null)?.[0];
      if (!row) return null;
      return { slotStart: row.slot_start, slotEnd: row.slot_end };
    },
  });
}
