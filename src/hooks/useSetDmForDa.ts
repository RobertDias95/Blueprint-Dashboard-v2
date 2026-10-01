import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';

// ===========================================================================
// ★★★ fix-617 §A.1 — ONE SERVER CALL FOR "WHO DOES THIS DA REPORT TO"
// ===========================================================================
//
// ⚖️ Bobby, 2026-10-01: **"Settings decides; the Draw Schedule follows."**
//
// This replaces `useUpsertDmDaGroup` / `useDeleteDmDaGroup` as the write path
// for Team Structure. Those two wrote `dm_da_groups` and nothing else, which is
// how the Draw Schedule's `group_label` came to be a second, free-text answer to
// the same question — the thing TeamStructureEditor's own fix-401 header warns
// about.
//
// `bp_set_dm_for_da` writes BOTH, atomically, for the current quarter and every
// later one. Past quarters are history and stay as they were.
//
// ★★ WHY ONE RPC AND NOT TWO CALLS FROM HERE. Two calls is two failure modes:
//    the mapping moves and the layout does not, and the screen then shows the
//    disagreement this ticket exists to remove. One server call cannot half-
//    succeed.
//
// ★ It never writes `permits.dm`. fix-379's trigger derives that column, and
//   §A.4 says so outright. A client that wrote it would be the second source
//   for a derived value.

export interface SetDmForDaInput {
  daName: string;
  /** The manager, or null / '' to unmap this DA entirely. */
  dmName: string | null;
}

export interface SetDmForDaResult {
  out_group_rows: number;
  out_layout_rows: number;
  out_quarters: string[] | null;
  out_unmapped: boolean;
}

export function useSetDmForDa() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<SetDmForDaResult, Error, SetDmForDaInput>({
    meta: { write: 'bp_set_dm_for_da' },
    mutationFn: async ({ daName, dmName }) => {
      const { data, error } = await supabase.rpc('bp_set_dm_for_da', {
        p_da_name: daName,
        p_dm_name: dmName ?? null,
      });
      if (error) throw error;
      const row = (data as SetDmForDaResult[])[0];
      if (!row) throw new Error('The move returned no result.');
      return row;
    },
    onSuccess: (res, { daName }) => {
      // ★★ BOTH CACHES, EVERY TIME. The mapping drives the wizard, the board
      //    lens, task co-assignment and the DM chip; the layout drives the draw
      //    schedule grid. One of them being stale is how "text and link
      //    disagree" comes back through a different door (fix-448's rule).
      queryClient.invalidateQueries({ queryKey: queryKeys.dmDaGroups(tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.drawScheduleQuarterLayoutAll });
      // ★ The permits and tasks whose derived DM / co-assignee the triggers just
      //   changed — server-side, so the client has to re-read rather than guess.
      queryClient.invalidateQueries({ queryKey: queryKeys.permits(tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });

      // ★ The toast says what moved beyond the row somebody clicked, because the
      //   layout change is the half that was invisible before this ticket.
      const quarters = (res.out_quarters ?? []).join(', ');
      pushToast(
        res.out_unmapped
          ? `${daName} now reports to nobody${
              res.out_layout_rows > 0 ? ` · ${quarters} ungrouped` : ''
            }`
          : `${daName} moved${
              res.out_layout_rows > 0
                ? ` · Draw Schedule updated for ${quarters}`
                : ''
            }`,
        'success',
      );
    },
    onError: (error) => {
      // ★★★ THE fix-379 GUARD'S MESSAGE REACHES THE PERSON VERBATIM. It is the
      //     one that says *"A departed associate keeps their mapping — mark them
      //     inactive on the roster instead."* That sentence is the answer, so it
      //     must not be replaced by a generic failure.
      pushToast(error.message, 'error');
    },
  });
}

// ===========================================================================
// §A.4 — what the move would change, asked before it is made
// ===========================================================================
//
// ★★ THE COUNTS COME FROM THE SERVER, not from whatever the client happens to
//    have cached. A dialog that counted open permits from a stale `usePermits`
//    would promise a number no other screen shows — and the whole point of the
//    sentence is that somebody can trust it.
export interface DmMovePreview {
  da: string;
  from_dm: string | null;
  to_dm: string | null;
  open_permits: number;
  open_tasks: number;
  layout_quarters: string[] | null;
  layout_rows: number;
}

export function useDmMovePreview(
  daName: string | null,
  dmName: string | null,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<DmMovePreview | null>({
    queryKey: queryKeys.dmMovePreview(tenantId ?? '', daName ?? '', dmName ?? ''),
    // ★ `enabled` on the DA means a closed dialog costs no request at all.
    enabled: !!tenantId && !!daName,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_preview_dm_move', {
        p_da_name: daName,
        p_dm_name: dmName ?? null,
      });
      if (error) throw error;
      return ((data as DmMovePreview[])[0] ?? null) as DmMovePreview | null;
    },
  });
}

/**
 * The sentence the confirm dialog shows.
 *
 * ★★★ PLAIN WORDS WITH THE COUNTS, which is what §A.4 asks for: *"Erick's 14
 *     open permits and 22 open tasks move to Derry."* Built here rather than in
 *     JSX so a test can read it without a DOM, and so the wording lives in one
 *     place instead of being assembled from three ternaries in a component.
 *
 * ★ It names the DERIVED consequence explicitly. Somebody moving a DA between
 *   managers is not thinking about `permits.dm`; they are thinking about an org
 *   chart. The sentence is where those two meet.
 */
export function describeDmMove(p: DmMovePreview | null): string {
  if (!p) return '';
  const da = p.da;
  const to = p.to_dm;
  const bits: string[] = [];
  if (p.open_permits > 0) {
    bits.push(`${p.open_permits} open permit${p.open_permits === 1 ? '' : 's'}`);
  }
  if (p.open_tasks > 0) {
    bits.push(`${p.open_tasks} open task${p.open_tasks === 1 ? '' : 's'}`);
  }

  const head = to
    ? `${da} will report to ${to}.`
    : `${da} will report to nobody.`;

  // ★ Nothing to move is worth SAYING, not worth leaving blank: "and nothing
  //   else changes" is the reassurance the dialog exists to give.
  if (bits.length === 0) {
    return `${head} They have no open permits or tasks, so nothing else changes.`;
  }

  const moved = to
    ? `move to ${to}`
    : 'lose their design manager';
  const quarters = (p.layout_quarters ?? []).join(', ');
  const layout =
    p.layout_rows > 0 && quarters !== ''
      ? ` The Draw Schedule follows for ${quarters}; earlier quarters stay as they were.`
      : '';

  return `${head} ${da}'s ${bits.join(' and ')} ${moved}.${layout}`;
}
