import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { useIsTenantAdmin } from './useIsTenantAdmin';
import { mayWrite, type WriteCap } from '../lib/writeLevel';

// ===========================================================================
// fix-538 (P-026) — what the ROSTER says this account may write
// ===========================================================================
//
// ★★★ THIS DECIDES WHAT TO RENDER. IT NEVER DECIDES WHETHER A WRITE IS
//     ALLOWED. Every capability it reports is checked again in the RPC, first
//     and unconditional, and the `42501` is the answer that counts. The browser
//     may hide a control; the browser may never be the reason a write lands.
//
// ★★ It asks the SERVER — `bp_write_caps()` — rather than re-deriving the map
//    from `team_members` here. Two implementations of one rule is how the UI
//    and the gate drift apart, and `src/lib/writeLevel.ts` is a mirror for
//    tests and for reasoning, not a second source of truth.
//
// ★★★ FAIL CLOSED, and specifically before the migration is applied. fix-538's
//     SQL is STAGED — until Cowork runs it, `bp_write_caps` does not exist and
//     this query errors. An error, a null, a missing session and a query still
//     in flight all answer **no capabilities**, so the app behaves exactly as
//     it does today (admin-only) until the day the function appears, and then
//     starts honouring the roster with no flag day and no deploy.

export function useWriteCaps(): WriteCap[] {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const q = useQuery<WriteCap[]>({
    queryKey: ['writeCaps', userId ?? ''],
    enabled: !!userId,
    // ★ A roster change is deliberate and rare (Settings → Team). A minute
    //   keeps every project page from re-asking; "takes effect on the next
    //   call" is the SERVER's promise, not this cache's — the RPC re-reads the
    //   roster itself on every write.
    staleTime: 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_write_caps');
      // ★ The staged-migration case: the function is not there yet. That is a
      //   no, not a crash — and it is why this hook can ship before the SQL.
      if (error) return [];
      return (Array.isArray(data) ? data : []) as WriteCap[];
    },
  });
  return q.data ?? [];
}

/**
 * The two controls stage one actually gates, resolved the way the server
 * resolves them: `is_tenant_admin(tenant) OR bp_may_…()`.
 *
 * ★★ §A.5 is why these are SEPARATE. `bp_reassign_project_sd` and
 *    `bp_reassign_project_da` are two different server gates, and the UI had
 *    ONE prop (`canReassignDa={isAdmin}`) disabling both controls. A single
 *    browser flag standing in front of two different server answers is how a
 *    control opens onto a refusal — or stays shut over a permission somebody
 *    has.
 */
export function useProjectTeamCaps(): {
  canReassignDa: boolean;
  canReassignSd: boolean;
} {
  const isAdmin = useIsTenantAdmin();
  const caps = useWriteCaps();
  return {
    canReassignDa: mayWrite(isAdmin, caps, 'reassign_da'),
    canReassignSd: mayWrite(isAdmin, caps, 'schematic_designer'),
  };
}
