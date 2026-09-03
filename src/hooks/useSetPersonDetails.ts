import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';

export interface PersonDetailsInput {
  /** The roster join key. NOT editable here — it identifies the person. */
  name: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * ★★★ fix-487 §B (P-120) — EDIT A PERSON'S DETAILS.
 *
 * Bobby: *"have the ability to edit our team database so i can enter their last
 * names too."* Ruled scope: **first name / last name / email only.**
 *
 * ---------------------------------------------------------------------------
 * ★★★ IT WRITES BY **NAME**, AND THAT IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------
 * The roster is one row per (person, role) and seven people carry two rows, so
 * these three fields are facts about the PERSON sitting on a ROLE ROW — the
 * trap fix-461 solved for `department` and fix-462 for `agenda_member`, both
 * with the same name-keyed RPC and a sync trigger.
 *
 * ★★ NOBODY HAD SOLVED IT FOR THE fix-343 NAME FIELDS, AND PROD SHOWED IT:
 *    Ana's `schematic` row carried her surname and address; her `da` row,
 *    added later by AdminTeamTab's "add to this list" (which sends only
 *    `{name, role}`), carried none. `resolveRosterIdentity` matches the
 *    signed-in address against `team_members.email`, so her Design Associate
 *    role was invisible to her own self-scope. The fix-487 migration healed it
 *    and added an INHERIT trigger so a second role row cannot start blank
 *    again.
 *
 * ★ So a row-id mutation would have been the bug, not the feature. This calls
 *   `bp_set_person_details`, whose signature cannot express `name` or `role`.
 */
export function useSetPersonDetails() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<number, Error, PersonDetailsInput>({
    mutationFn: async ({ name, first_name, last_name, email }) => {
      const { data, error } = await supabase.rpc('bp_set_person_details', {
        p_name: name,
        // ★ '' is sent as-is and the RPC nulls it. Clearing a wrong surname is
        //   a real edit, so an empty field must reach the database rather than
        //   being read as "leave it alone".
        p_first_name: first_name,
        p_last_name: last_name,
        p_email: email,
      });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: (rows, { name }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(tenantId) });
      // ★ The row count is said out loud for the same reason fix-461 says it:
      //   it is how somebody SEES that editing Ana moved both of her roster
      //   rows, rather than having to trust that it did.
      pushToast(
        rows > 1
          ? `Saved ${name}'s details (${rows} roster rows)`
          : rows === 1
            ? `Saved ${name}'s details`
            : `${name}'s details were already up to date`,
        'success',
      );
    },
    onError: (err) => {
      pushToast(err.message || 'Could not save those details', 'error');
    },
  });
}
