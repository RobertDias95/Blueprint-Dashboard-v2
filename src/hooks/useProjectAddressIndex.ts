import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { AddressCandidate } from '../lib/addressMatch';

// fix-333 — every address the duplicate check must be able to see.
//
// ★★ WHY THIS IS ITS OWN QUERY AND NOT A REUSE OF useProjects.
//
// Three reasons, and the second one is the ticket:
//
//   1. useProjects selects THIRTY columns for the matrix and the overview. This
//      needs four, on every keystroke of a debounced check.
//
//   2. ★ useProjects filters `archived = false`. A duplicate against an ARCHIVED
//      project is still a duplicate — it is the same lot, and the person typing
//      needs to know it is already in the tool before they file a second copy.
//      Reusing that hook would have built a check with a blind spot nobody
//      could see from the call site.
//
//   3. ★★ useProjects has no `.range()`. fix-189 recorded what that costs: an
//      un-ranged PostgREST select silently stops at 1000 rows with NO error and
//      NO indication. A list view that quietly shortens is bad; a DUPLICATE
//      CHECK that quietly shortens is worse than not having one, because it
//      reports "no match found" and is believed.
//
// ★ SO TRUNCATION IS DETECTED, NOT ASSUMED AWAY. The query asks for LIMIT + 1
// rows. Getting LIMIT + 1 back means there is at least one more beyond the
// window, and `truncated` goes true — at which point the banner says the check
// is INCOMPLETE rather than saying the address is clear. Measured 2026-08-17:
// 146 projects, so the cap is 34× the current data and this is a guard against
// a future nobody will be watching for, not a live problem.

/** 5000. Chosen against 146 real projects — room for the tool to grow 30× before
 *  anybody has to think about paging, and still one round trip. */
export const ADDRESS_INDEX_LIMIT = 5000;

export interface ProjectAddressIndex {
  candidates: AddressCandidate[];
  /** ★ True when there are more projects than the window. The check cannot
   *  claim "no duplicate" while this is set. */
  truncated: boolean;
}

export function useProjectAddressIndex(enabled = true) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectAddressIndex>({
    queryKey: queryKeys.projectAddressIndex(tenantId ?? ''),
    enabled: enabled && !!tenantId,
    // The address list changes only when somebody creates a project. Five
    // minutes keeps a debounced per-keystroke check off the network entirely.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // ★ ARCHIVED PROJECTS ARE INCLUDED — see reason 2 above. No `.eq` filter
      // here on purpose; the absence is the decision.
      const { data, error } = await supabase
        .from('projects')
        .select('id, address, go_date, archived, redesign_of_project_id')
        .order('address', { ascending: true })
        .range(0, ADDRESS_INDEX_LIMIT); // inclusive → asks for LIMIT + 1
      if (error) throw error;
      const rows = (data ?? []) as AddressCandidate[];
      const truncated = rows.length > ADDRESS_INDEX_LIMIT;

      // ★ The permit numbers are what made the Othello duplicate unmissable in
      // hindsight — the copy carried the SAME THREE. Fetched as one flat index
      // and joined here rather than per-match, so a debounced check costs no
      // extra round trip. 503 permit rows today.
      const { data: permitRows, error: permitError } = await supabase
        .from('permits')
        .select('project_id, num')
        .not('num', 'is', null)
        .range(0, ADDRESS_INDEX_LIMIT * 4);
      // ★ A failed permit fetch degrades to "no permit numbers shown" rather
      // than failing the whole check. The address match is the load-bearing
      // part; the numbers are recognition aid.
      if (!permitError && permitRows) {
        const byProject = new Map<string, string[]>();
        for (const r of permitRows as { project_id: string; num: string }[]) {
          const list = byProject.get(r.project_id);
          if (list) list.push(r.num);
          else byProject.set(r.project_id, [r.num]);
        }
        for (const c of rows.slice(0, ADDRESS_INDEX_LIMIT)) {
          c.permitNums = byProject.get(c.id)?.sort() ?? [];
        }
      }

      return { candidates: rows.slice(0, ADDRESS_INDEX_LIMIT), truncated };
    },
  });
}
