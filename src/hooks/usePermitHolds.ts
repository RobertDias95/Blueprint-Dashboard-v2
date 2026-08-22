import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { PermitHold } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-390 — ONE PERMIT PAUSED, WITHOUT PAINTING ITS PROJECT
// ===========================================================================
//
// From the register: "Permit-level holds, not just project-level." When a ULS
// waits on the city while the BP proceeds, holding the whole project lies about
// the BP and holding nothing lies about the ULS.
//
// ★★ THIS FILE IS `useProjectHolds.ts` AT A SMALLER SCOPE, deliberately — same
// hook names with the noun swapped, same open/released lifecycle, same
// SECURITY DEFINER RPCs, same bare-prefix invalidation. fix-364's rule: one
// concept, one term. Read them side by side.
//
// ★★★ WHAT IS DELIBERATELY MISSING: everything cancel. No `activeCancel`, no
// `cancelledPermitIds`, no set/restore mutations. fix-262 made CANCEL a PROJECT
// outcome and an axis for volume attribution; a dead PERMIT is **Withdrawn** at
// the portal, which fix-388 already taught the board to respect. Adding a
// permit cancel would be a second answer to a settled question.
//
// ★★★ AND NOTHING HERE ROLLS UP TO A PROJECT. There is no
// `heldProjectIdsFromPermits` and there must never be: a permit hold covers its
// permit and stops. The one-way hierarchy is the whole point of the ticket.

const SELECT_COLUMNS =
  'id, tenant_id, permit_id, reason, note, hold_start, hold_end, kind, created_by, created_at, updated_at';

/** All holds for one permit, newest first. The active hold (if any) is the row
 *  with `hold_end === null` — the DB enforces at most one. */
export function usePermitHolds(permitId: number | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitHold[]>({
    queryKey: queryKeys.permitHolds(tenantId ?? '', permitId ?? 0),
    enabled: !!tenantId && permitId != null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_holds')
        .select(SELECT_COLUMNS)
        .eq('permit_id', permitId as number)
        .order('hold_start', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PermitHold[];
    },
  });
}

/**
 * Every hold in the tenant, for the surfaces that need "which permits are
 * paused" in one fetch — the board, the badges, schedule health.
 *
 * ★ Holds are rare (a handful per tenant), which is why the sibling fetches all
 * of them once rather than per-project, and why this does the same.
 */
export function useAllPermitHolds() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PermitHold[]>({
    queryKey: queryKeys.allPermitHolds(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permit_holds')
        .select(SELECT_COLUMNS)
        .order('hold_start', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PermitHold[];
    },
  });
}

/** The OPEN row from a holds list, or null. */
export function activePermitHold(
  holds: PermitHold[] | undefined,
): PermitHold | null {
  return holds?.find((h) => h.hold_end === null) ?? null;
}

/** Set of permit ids currently on an OPEN hold — the "is this paused" question,
 *  answered from the one bulk fetch. */
export function activeHoldPermitIds(
  holds: PermitHold[] | undefined,
): Set<number> {
  const s = new Set<number>();
  for (const h of holds ?? []) {
    if (h.hold_end === null) s.add(h.permit_id);
  }
  return s;
}

/** permit_id → its open hold, so a surface can show the reason and the date
 *  without a per-permit query. Mirrors `activeHoldByProjectId`. */
export function activeHoldByPermitId(
  holds: PermitHold[] | undefined,
): Map<number, PermitHold> {
  const m = new Map<number, PermitHold>();
  for (const h of holds ?? []) {
    if (h.hold_end === null) m.set(h.permit_id, h);
  }
  return m;
}

/** Index all holds (open + released) by permit, for the history list. */
export function holdsByPermitId(
  holds: PermitHold[] | undefined,
): Map<number, PermitHold[]> {
  const m = new Map<number, PermitHold[]>();
  for (const h of holds ?? []) {
    const list = m.get(h.permit_id) ?? [];
    list.push(h);
    m.set(h.permit_id, list);
  }
  return m;
}

export interface SetPermitHoldInput {
  permitId: number;
  reason: string;
  note?: string | null;
  holdStart?: string | null;
}

/** Open a hold on one permit (refused if one is already open). */
export function useSetPermitHold() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<PermitHold, Error, SetPermitHoldInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_set_permit_hold', {
        p_tenant_id: tenantId,
        p_permit_id: input.permitId,
        p_reason: input.reason,
        p_note: input.note ?? null,
        p_hold_start: input.holdStart ?? null,
      });
      if (error) throw error;
      const row = (data as PermitHold[])[0];
      if (!row) throw new Error('Set hold returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permitHoldsAll });
      pushToast('Permit put on hold', 'success');
    },
    onError: (error) => {
      pushToast(`Could not put on hold — ${error.message}`, 'error');
    },
  });
}

export interface LiftPermitHoldInput {
  permitId: number;
  holdEnd?: string | null;
}

/** Release the open hold. ★ Reversible by design — the milestone chips this
 *  silenced come back on the next render, because nothing was acked or
 *  written; the hold was the only reason they were quiet. */
export function useLiftPermitHold() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<PermitHold, Error, LiftPermitHoldInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_lift_permit_hold', {
        p_tenant_id: tenantId,
        p_permit_id: input.permitId,
        p_hold_end: input.holdEnd ?? null,
      });
      if (error) throw error;
      const row = (data as PermitHold[])[0];
      if (!row) throw new Error('Lift hold returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permitHoldsAll });
      pushToast('Permit hold lifted', 'success');
    },
    onError: (error) => {
      pushToast(`Could not lift hold — ${error.message}`, 'error');
    },
  });
}

export interface UpdatePermitHoldInput {
  holdId: string;
  reason?: string | null;
  note?: string | null;
  holdStart?: string | null;
  holdEnd?: string | null;
}

/** Correct a hold's reason / note / dates. */
export function useUpdatePermitHold() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<PermitHold, Error, UpdatePermitHoldInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_update_permit_hold', {
        p_tenant_id: tenantId,
        p_hold_id: input.holdId,
        p_reason: input.reason ?? null,
        p_note: input.note ?? null,
        p_hold_start: input.holdStart ?? null,
        p_hold_end: input.holdEnd ?? null,
      });
      if (error) throw error;
      const row = (data as PermitHold[])[0];
      if (!row) throw new Error('Update hold returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permitHoldsAll });
      pushToast('Hold updated', 'success');
    },
    onError: (error) => {
      pushToast(`Could not update hold — ${error.message}`, 'error');
    },
  });
}
