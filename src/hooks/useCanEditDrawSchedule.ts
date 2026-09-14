import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// fix-567 §D (P-271) — ask the SERVER whether this person may edit the draw
// schedule
// ===========================================================================
//
// ★★★ IT ASKS `bp_can_edit_draw_schedule()` — **the same function the server
//     asks.** That function gates the ten SECURITY DEFINER draw-schedule RPCs
//     through `bp_assert_draw_schedule_admin()`, and it now carries
//     `may_edit_draw_schedule` alongside the two admin tests. So the button
//     and the gate cannot disagree about who may write.
//
// ★★★ WHAT THIS REPLACES, AND WHY IT MATTERED. The grid read
//     `useIsTenantAdmin()` — a second, client-side statement of the rule. The
//     moment a non-admin holds the new flag those two answers diverge, and the
//     divergence is the bad direction: **a screen that says no to somebody the
//     database says yes to.** Shire would have been granted the capability and
//     still seen a read-only board.
//
// ⚠️ **Two writers of one rule is the single most repeated defect in this
//    Brain** — P-207, P-179, P-244, fix-531, fix-541 §A, and fix-549 §B closed
//    the same hole for project writes. Re-deriving "is this person an admin, or
//    do they hold the draw-schedule grant" in TypeScript would be another.
//
// ★★ FAIL CLOSED, and it costs nothing: an error, a missing session and a query
//    still in flight all read **no**, which renders the board read-only. A
//    moment of read-only on a slow network is a smaller wrong than a control
//    that accepts a drag the server will refuse.
//
// ★ THE TENANT CHECK IS NOT HERE AND MUST NOT BE. `bp_can_edit_draw_schedule`
//   is deliberately tenant-agnostic — it answers "may this person edit a draw
//   schedule at all" — while the three RLS policies keep
//   `tenant_id = any(auth_tenant_ids())` above the grant. The grant crosses
//   projects, never tenants, and the row-level check is what enforces that.

export function useCanEditDrawSchedule(): boolean {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const q = useQuery<boolean>({
    queryKey: ['canEditDrawSchedule', userId ?? ''],
    enabled: !!userId,
    // ★ The answer changes when a grant is made or an admin is added —
    //   deliberate, rare acts. A minute keeps every cell from re-asking, and
    //   the server re-reads the rule on every write regardless: this cache can
    //   only make the board briefly stricter, never briefly permissive.
    staleTime: 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_can_edit_draw_schedule');
      if (error) return false;
      return data === true;
    },
  });
  return q.data === true;
}
