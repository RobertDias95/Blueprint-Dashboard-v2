import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// fix-549 (P-255) — ask the SERVER whether this project may be written
// ===========================================================================
//
// ★★★ NINE REFUSALS IN FOUR MINUTES, ONE PERSON. `error_reports` 718–726, all
//     Cam, all `projects.update`, all on 1917 3rd Ave W: Lot Size six times,
//     then Unit Size three more. The product let him work and then threw it
//     away, nine times.
//
// ★★★ IT ASKS `bp_may_write_project` — THE SAME FUNCTION THE SERVER ASKS. The
//     RLS policy on `projects` and `bp_update_project_fields`,
//     `bp_add_project_consultant` and `bp_set_consultant_firm` all call it, so
//     the screen and the gate cannot disagree about who may write.
//
// ⚠️ **Two writers of one rule is the single most repeated defect in this
//    Brain** — P-207, P-179, P-244, fix-531, fix-541 §A. Re-deriving "is this
//    person a DA on this project, or does it have no DA, or do they hold the
//    all-projects flag" in TypeScript would be a fifth. The rule stays in one
//    place and the browser asks it.
//
// ★★ FAIL CLOSED, and it costs nothing to do so: an error, a missing session
//    and a query still in flight all read as **no**, which renders the fields
//    read-only. A moment of read-only on a slow network is a smaller wrong
//    than a box that accepts typing the server will refuse.

export function useMayWriteProject(projectId: string | null | undefined): boolean {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const q = useQuery<boolean>({
    queryKey: ['mayWriteProject', userId ?? '', projectId ?? ''],
    enabled: !!userId && !!projectId,
    // ★ The answer changes when a roster row changes or a grant is made —
    //   deliberate, rare acts. A minute keeps every field from re-asking, and
    //   the server re-reads the rule on every write regardless: this cache can
    //   only make the screen briefly stricter, never briefly permissive.
    staleTime: 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_may_write_project', {
        p_project_id: projectId,
      });
      if (error) return false;
      return data === true;
    },
  });
  return q.data === true;
}
