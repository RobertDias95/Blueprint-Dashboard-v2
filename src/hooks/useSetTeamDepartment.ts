import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Department } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-461 §0d — THE WRITE PATH
// ===========================================================================
//
// ★★ IT TAKES A NAME, NEVER A ROW ID, and that is the point rather than a
// convenience. The unit of a department is the PERSON; handing this an id would
// invite a caller to think in role rows, which is exactly the mistake §0c
// exists to prevent. (The database trigger would still catch it — this just
// stops the wrong idea being expressible in the client at all.)
//
// ★★★ INVOKER, BECAUSE THE TABLE ALREADY DECIDES. `team_members` carries
// `team_members_tenant_admin_write`, gating ALL verbs on
// `is_tenant_admin(tenant_id)`. So the DATABASE refuses a non-admin and the
// panel's `readOnly` only hides the buttons — the same division fix-347 and
// fix-401 use. A SECURITY DEFINER function here would be a weaker second copy
// of a policy that already works, and would quietly let a non-admin write.
//
// ★ No OCC token. A department is one nullable column on a person, set from one
// screen by one admin; there is no concurrent-edit story to lose, and the
// sibling registries' OCC pair would be ceremony without a risk to guard.

export function useSetTeamDepartment() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<number, Error, { name: string; department: Department | null }>({
    mutationFn: async ({ name, department }) => {
      const { data, error } = await supabase.rpc('bp_set_team_department', {
        p_name: name,
        // ★ NULL is a legitimate value to SET, not only to start at — Bobby has
        //   to be able to un-classify somebody he classified by mistake.
        p_department: department,
      });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: (rows, { name }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(tenantId) });
      // ★ The row count is worth saying out loud: it is how somebody sees that
      //   setting Dave's department moved BOTH of his rows, which is the
      //   mechanism doing its job in public.
      pushToast(
        rows > 1
          ? `Set ${name}'s department (${rows} roster rows)`
          : `Set ${name}'s department`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Could not set the department — ${error.message}`, 'error');
    },
  });
}
