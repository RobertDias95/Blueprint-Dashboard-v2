import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { ConsultantCurrent } from '../lib/consultants';

// ===========================================================================
// ★★★ fix-499 (P-034) — the TENANT-WIDE consultant read
// ===========================================================================
//
// `useProjectConsultants` (fix-474) is per project: the Overview card asks about
// one address. The discipline forecast asks the opposite question — "every
// project this discipline is on" — and there was no reader for it.
//
// ★★★ STEP 0 ASKED WHETHER THIS NEEDED AN RPC. IT DOES NOT, and the answer is
//     worth writing down because it decided the shape of this ticket:
//
//       - `project_consultant_current` SELECTs `c.tenant_id` (verified against
//         pg_get_viewdef on prod, 2026-09-04).
//       - The view is `security_invoker=true`, so the caller's RLS applies —
//         it is not a privilege hole waiting to be found.
//       - Every table under it (`project_consultants`,
//         `project_consultant_rounds`, `external_team_directory`) carries a
//         PLAIN TENANT policy: `tenant_id = ANY (auth_tenant_ids())`. Not one
//         of them is scoped by project or by membership in a project.
//       - `authenticated` holds SELECT on the view.
//
//     So a tenant-wide read is an ordinary select, and NO `security definer`
//     function is involved. The brief's stop-condition ("if an RPC would need
//     security definer, stop — that is a grants decision") never fired: there
//     is no grant to decide. Proven end to end on prod inside a rolled-back
//     transaction, reading as a real member: 165 rows across 7 disciplines.
//
// ★★ NOT `enabled` ON A PROJECT. The whole point is that there is no project.
//    The query key deliberately shares `projectConsultantsAll`'s prefix so the
//    fix-474 mutations already invalidate it — a consultant edited on the
//    Overview card refreshes this report without a second invalidation list to
//    keep in sync.

/** Every consultant record in the tenant, with its LATEST live round flattened
 *  on — the same view, and therefore the same definition of "current round",
 *  that the per-project card reads. */
export function useConsultantCurrent(enabled = true) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ConsultantCurrent[]>({
    queryKey: queryKeys.consultantCurrentAll(tenantId ?? ''),
    enabled: !!tenantId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_consultant_current')
        // ★ An EXPLICIT select list, and the fix-386/410/461/467 trap is why
        //   this comment is here too: a column added to the view is INVISIBLE
        //   until it is named, with no error. Kept identical to
        //   useProjectConsultants' list so the two readers cannot drift.
        .select(
          'consultant_id, tenant_id, project_id, discipline, firm_id, firm_name, ' +
            'firm_active, notes, updated_at, round_id, round_index, phase, status, ' +
            'est_send, sent, est_recd, recd, round_updated_at, round_count',
        )
        .order('discipline', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ConsultantCurrent[];
    },
    staleTime: 30 * 1000,
  });
}
