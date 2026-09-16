import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict, occToken } from '../lib/occ';
import { occInsertKey, occRowKey, occSerialize } from '../lib/occQueue';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// ★★★ fix-460 §B5 (P-046) — WRITING A TASK THAT HAS NO PERMIT
// ===========================================================================
//
// ★★ THERE IS NO READ HOOK HERE, DELIBERATELY. Team tasks arrive through
// `bp_list_tasks` alongside permit tasks — the union lives in the RPC, so every
// board, filter, count, band and badge already has them and no second read
// exists to disagree with the first. This file is only the write side.
//
// ★ Shape copied from useUpsertDaTeamRouting (fix-457) / useUpsertDmDaGroup:
// an OCC-guarded RPC that returns `conflict` as a VALUE, which the hook turns
// into an OCCConflictError.

interface UpsertRow {
  out_id: string;
  updated_at: string;
  conflict: boolean;
}

/** The editable fields of a team task. Everything is optional except `text` —
 *  a task with no description is not a task. */
export interface TeamTaskPatch {
  text: string;
  notes?: string | null;
  assigned_to?: string | null;
  /** ★ THE BLEND POINT: which of the two existing board lanes this lands in. */
  discipline?: 'arch' | 'ent';
  start_date?: string | null;
  due_date?: string | null;
  target_date?: string | null;
  completion_status?: string;
  priority?: boolean;
  sort_order?: number;
  source_message_id?: string | null;
  /** ★★ A LINK BACK, NOT AN OWNER — stored, never surfaced as project_id. */
  ref_project_id?: string | null;
  ref_permit_id?: number | null;
  /** ★★★ fix-462 §C3: on the weekly agenda.
   *
   *  ★ OMITTING IT MEANS "LEAVE IT ALONE" ON AN UPDATE and `false` on an
   *  insert — the RPC coalesces to the stored value — so no existing caller can
   *  clear an item off the agenda by not mentioning it. */
  agenda?: boolean;

  // ═════════════════════════════════════════════════════════════════════════
  // ★★★ fix-580 §B (P-285) — EXPLICIT CLEARS, BECAUSE THE PATCH IS PARTIAL
  // ═════════════════════════════════════════════════════════════════════════
  //
  // **MEASURED, NOT ASSUMED: the client sends a PARTIAL patch.** There is one
  // update caller in the repo — `TaskDetailEditor`'s team branch — and it sends
  // eight keys (the eight in prod rows 731/732's `fields`). The UPDATE branch of
  // `bp_upsert_team_task` assigned NINE columns unconditionally, with no
  // `coalesce` to the existing row:
  //
  //   text, notes, assigned_to, discipline, start_date, due_date, target_date,
  //   ref_project_id, ref_permit_id
  //
  // ★★★ SO `due_date`, `ref_project_id` AND `ref_permit_id` WERE SET TO NULL ON
  //     EVERY EDIT FROM THAT PANEL. Nothing has lost a value yet only because
  //     the update branch has never once succeeded (the `''` token above) and
  //     because all four prod rows happen to hold NULL in all three. The shape
  //     was wrong before it was ever reachable.
  //
  // ★ AND `discipline` WAS THE QUIETER ONE: absent, it defaulted to `'ent'`
  //   rather than to the stored value, so an `arch` team task edited by a
  //   caller that omitted the field would silently change lane.
  //
  // ⚠️ THE MIGRATION COALESCES THOSE COLUMNS, AND A COALESCE TURNS *"clear this
  //    date"* INTO A NO-OP — so clearing needs a flag, exactly as
  //    `bp_upsert_permit_task` has done since fix-138-a with `p_clear_due_date`
  //    / `p_clear_assigned_to`. That is the pattern reused here, carried as
  //    `p_data` keys rather than as new arguments: adding parameters to a
  //    `CREATE OR REPLACE` makes an OVERLOAD, and an ambiguous overload is how
  //    fix-438 broke PostgREST.
  clear_notes?: boolean;
  clear_assigned_to?: boolean;
  clear_start_date?: boolean;
  clear_due_date?: boolean;
  clear_target_date?: boolean;
  clear_ref_project_id?: boolean;
  clear_ref_permit_id?: boolean;
}

export type UpsertTeamTaskInput =
  | { op: 'insert'; patch: TeamTaskPatch }
  | {
      op: 'update';
      id: string;
      /** ★★★ fix-580: the row's real OCC token, or `null` when the caller has
       *  not got one. **`''` is not a token** — see the header below. */
      updated_at: string | null;
      patch: TeamTaskPatch;
    };

// ===========================================================================
// ★★★ fix-580 §A (P-285) — WHICH STATE PRODUCED THE `""`. NOT GUESSED.
// ===========================================================================
//
// The brief offered two candidates — a NEW task with no prior row, or an EDIT
// whose token was lost through a re-render. **It is neither.** It is an edit
// whose token was NEVER FETCHED, and the `""` was a hand-written literal:
//
//   TaskDetailEditor.tsx, the team-task branch of `patch()`, as shipped —
//     updated_at: '',
//     // "…`bp_list_tasks` does not carry `updated_at` … so an empty token is
//     //  a deliberate last-write-wins on a panel only one person has open."
//
// ★★★ AND THE PROOF IT IS THAT LINE AND NOT ANOTHER IS THE `fields` LIST.
//     Rows 731/732 carry exactly `[text, discipline, start_date, target_date,
//     assigned_to, completion_status, priority, notes]` — eight keys, in that
//     order. That is this object, literally; `TeamTaskComposer` sends four
//     different keys and is the only other caller. The insert path has always
//     sent a real `null` and has never been able to produce this.
//
// ★★ THE COMMENT'S INTENT WAS SOUND AND ITS MECHANISM WAS NOT. `''` does not
//    mean last-write-wins to PostgREST; it means a `timestamptz` cast that
//    fails before the function runs. **The update branch of
//    `bp_upsert_team_task` has therefore never succeeded once** — measured:
//    4 team tasks on prod, the only two ever updated went to `Resolved`, which
//    is `bp_set_team_task_status`, a different RPC with no OCC guard at all.
//
// ---------------------------------------------------------------------------
// ⚠️ WHY `occToken` ALONE WOULD NOT HAVE FIXED IT
// ---------------------------------------------------------------------------
//
// `''` → `null` stops the 400, and then `WHERE tt.updated_at = null` matches no
// row, so the write comes back `conflict: true` and Brittani gets a toast
// instead of a save. **Same data loss, quieter.** A normaliser can make a bad
// token legible; it cannot invent a good one.
//
// ★★★ SO THE TOKEN IS FETCHED. `bp_list_tasks` gains `updated_at` in the
//     fix-580 migration, and until that is applied this reads the row's stamp
//     directly — `team_tasks` grants SELECT to `authenticated` under
//     `tenant_id = ANY(auth_tenant_ids())`, so the same person who may edit the
//     row may read its stamp. The branch costs one round trip and goes cold on
//     its own the moment the migration lands, because the caller then always
//     has a token.

export function useUpsertTeamTask() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<{ id: string; updated_at: string }, Error, UpsertTeamTaskInput>({
    // ★ fix-511 §C / fix-580: name the RPC in Error Reports. Rows 731/732 cost
    //   four queries to attribute because `fields` was all they carried.
    meta: { write: 'bp_upsert_team_task' },
    mutationFn: async (input) =>
      // ★★★ fix-584 §B: the row-fetch below is fix-580's bridge for a caller
      //     that has NO token; the serializer is what handles a caller whose
      //     token is merely one write behind. Different failures, one mechanism.
      occSerialize(
        input.op === 'insert'
          ? occInsertKey('team_tasks')
          : occRowKey('team_tasks', input.id),
        input.op === 'insert' ? null : occToken(input.updated_at),
        async (expected) => {
        const value = await (async () => {
      const isInsert = input.op === 'insert';
      let token = isInsert ? null : expected;
      if (!isInsert && token === null) {
        // ★★★ fix-580: the caller has no token. Go and get one rather than
        //     posting a lie — see the header. Falls through to `null` (and so
        //     to an honest conflict) if the row is unreadable or gone.
        const { data: row } = await supabase
          .from('team_tasks')
          .select('updated_at')
          .eq('id', input.id)
          .maybeSingle();
        token = occToken((row as { updated_at?: string } | null)?.updated_at);
      }
      const { data, error } = await supabase.rpc('bp_upsert_team_task', {
        p_id: isInsert ? null : input.id,
        p_data: input.patch,
        p_expected_updated_at: token,
      });
      if (error) throw error;
      const row = (data as UpsertRow[])[0];
      if (!row) throw new Error('Upsert returned no row');
      if (row.conflict) {
        // ★★ fix-579's shape, reused: the function re-reads the row into
        //    `v_actual` on its conflict path and returns it as `updated_at`,
        //    so BOTH sides of the refused comparison are already on the wire.
        //    A null `actual` means the row is GONE, not that it changed.
        throw new OCCConflictError(0, 'Team task', {
          rowId: isInsert ? undefined : input.id,
          expected: token,
          actual: row.updated_at ?? null,
        });
      }
      return { id: row.out_id, updated_at: row.updated_at };
        })();
        return { value, token: value.updated_at };
      }),
    onSuccess: () => {
      // ★★ THE SAME KEY THE BOARD READS. Team tasks come back through
      //    bp_list_tasks, so invalidating that one query is what makes a new
      //    team task appear everywhere at once — the property the union buys.
      queryClient.invalidateQueries({ queryKey: queryKeys.allTasks(tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.allTasks(tenantId) });
      } else {
        pushToast(`Could not save the task — ${error.message}`, 'error');
      }
    },
  });
}

/**
 * ★★★ fix-460 — the status flip for a team task.
 *
 * A focused single-field RPC rather than a reuse of `bp_upsert_team_task`, and
 * the reason is the same one fix-434 gives for the whole status path: the
 * checkbox and the chip fire in bursts, and an OCC token that must be read,
 * sent and re-read between clicks is exactly what makes a burst lose writes.
 * A status flip is one column and last-write-wins is the correct semantics for
 * it — the optimistic overlay in `useSetTaskStatus` already collapses a burst
 * into one call before this is reached.
 */
export function useSetTeamTaskStatus() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: string; status: string }>({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.rpc('bp_set_team_task_status', {
        p_id: id,
        p_status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.allTasks(tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
    },
    onError: (error) => {
      pushToast(`Could not update the task — ${error.message}`, 'error');
    },
  });
}
