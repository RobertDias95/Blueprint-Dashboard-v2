import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// ★★★ fix-592 §A (P-291) — THE DISCIPLINES THE UNIQUE INDEX STILL REFUSES
// ===========================================================================
//
// **Lindsay, 2026-09-23, 3020 E Yesler Way — three `duplicate key value
// violates unique constraint "project_consultants_one_per_discipline"` in 106
// seconds, then she stopped.**
//
// ★★★ THE BRIEF'S READING DOES NOT SURVIVE THE DATA, and this is the whole
//     finding. §A says *"Nothing told her a Civil was already on that project"*
//     and blames a picker that *"offers a taken discipline and then
//     apologises."* **There was no Civil on that project, and the picker was
//     right to offer it.** The prod timeline:
//
//       15:33:48  Civil added
//       15:36:11  Civil REMOVED   ← `removed_at` stamped; the row stays
//       15:37:42  duplicate key   (report 744)
//       15:37:59  Geotech added
//       15:38:05  Geotech REMOVED
//       15:38:10  duplicate key   (report 745)
//       15:38:29  duplicate key   (report 746)
//
// ★★★ THE CAUSE IS THAT REMOVE IS A SOFT DELETE AND THE INDEX IS NOT PARTIAL:
//
//       CREATE UNIQUE INDEX project_consultants_one_per_discipline
//         ON public.project_consultants USING btree (project_id, discipline);
//                                                    -- no WHERE removed_at IS NULL
//
//     `project_consultant_current` hides a removed row, so the picker sees the
//     slot as free; the index still counts it, so the insert is refused. **A
//     removed consultant holds its discipline for ever.**
//
// ★★★ AND THE MEASURED POPULATION IS 2 OF 2. Prod, 2026-09-28: 198 consultant
//     rows, **exactly 2 with `removed_at` set** — Lindsay's Civil and her
//     Geotech — and **both** of those slots are now permanently unaddable. The
//     brief's *"198 rows, zero duplicates, so the rule has held everywhere"* is
//     true and misleading: there are no duplicates BECAUSE the index forbids
//     them, and remove has been used twice, and broke re-add both times.
//     fix-514 §D's remove has never once been followed by a successful re-add.
//
// ⏸ THE MODEL QUESTION IS BOBBY'S AND IS NOT TOUCHED HERE. Making the index
//    partial would keep "one LIVE consultant per discipline" exactly as it is
//    and only stop removed rows from squatting — but it is still a constraint
//    change, and the instruction on this ticket is explicit: improve the message
//    only. So this hook makes the app TELL THE TRUTH about the slot, and the PR
//    carries the finding for a ruling.
//
// ★ Reads the BASE TABLE, not the view: the view's whole job is to hide these
//   rows. `authenticated` has SELECT on `project_consultants` under the same
//   tenant policy (verified on prod), so no migration is needed to ask.
//
// ═══════════════════════════════════════════════════════════════════════════
// ★★★ AND IT IS ITS OWN MODULE, WHICH IS NOT TIDINESS — IT IS THE FIX-415
//     LESSON, PAID FOR AGAIN
// ═══════════════════════════════════════════════════════════════════════════
//
// This hook started life inside `useProjectConsultants.ts`, and **46 suites
// factory-mock that module**:
//
//     vi.mock('../hooks/useProjectConsultants', () => ({
//       useProjectConsultants: () => ({ data: [] }),
//       useAddProjectConsultant: () => ({ mutate: vi.fn() }),
//       ...
//     }))
//
// A factory mock REPLACES the module, so every export it does not list is
// `undefined`. Adding one export to that file turned `ConsultantBand` into
// `undefined is not a function` in **155 tests across 21 files** — the same trap
// fix-415 hit ("a lib module importing from a mocked hook module broke 86 tests
// — inline the helper") and the one the memory calls "the partial-mock trap,
// third time".
//
// ★★★ A NEW MODULE CANNOT BE PARTIALLY MOCKED, because nobody mocks it. Those 46
//     suites call the real hook, their own `lib/supabase` stub answers it (or the
//     query simply fails and `?? []` applies), and not one of them had to change.
//     **Growing a widely-mocked module is a breaking change to every mock of
//     it**; that is worth a file.

/**
 * Disciplines on this project whose slot is held ONLY by a removed consultant.
 *
 * ★ Each one is a discipline the view reports as free and the database will
 *   refuse. Empty for 269 of 270 projects, so every other screen renders
 *   exactly as it does today.
 */
export function useBlockedConsultantDisciplines(
  projectId: string | null | undefined,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<string[]>({
    queryKey: queryKeys.projectConsultantsBlocked(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_consultants')
        .select('discipline, removed_at')
        .eq('project_id', projectId as string);
      if (error) throw error;
      const rows = (data ?? []) as { discipline: string; removed_at: string | null }[];
      const live = new Set<string>();
      const removed = new Set<string>();
      for (const r of rows) {
        const d = (r.discipline ?? '').trim();
        if (!d) continue;
        (r.removed_at ? removed : live).add(d.toLowerCase());
      }
      // ★ A discipline with a LIVE row is "taken", which the picker already
      //   handles off the view. Blocked means removed AND not live — the state
      //   only the index can see.
      return rows
        .filter(
          (r) =>
            r.removed_at &&
            (r.discipline ?? '').trim() !== '' &&
            !live.has(r.discipline.trim().toLowerCase()),
        )
        .map((r) => r.discipline.trim())
        .filter((d, i, a) => a.indexOf(d) === i)
        .sort();
    },
  });
}

