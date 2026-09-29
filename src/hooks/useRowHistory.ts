import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import {
  toHistoryEntry,
  type AuditLogRow,
  type HistoryEntry,
} from '../lib/rowHistory';

// ===========================================================================
// ★★★ fix-590 §2 — SEE THE HISTORY, AND PUT A VERSION BACK
// ===========================================================================
//
// §2: *"A history nobody can act on is a longer version of the problem. Bobby's
// ask was **a way to quickly restore**, not a way to find out. If this ticket
// ships only a trigger, it has not shipped the ask."*
//
// ★★★ EVERY HOOK HERE WORKS WITH THE MIGRATION UNAPPLIED, because it is staged
//     and Bobby applies it. The read returns nothing (the column and the rows do
//     not exist yet) and the panel says so; the restore RPC is absent, which
//     PostgREST reports as a missing function, and the toast says the feature is
//     not switched on yet rather than showing a stack trace. **CI is green with
//     it unapplied and so is prod.**

/** ★ 40 is what fits a panel without a scroll of its own; the tail is older than
 *  anybody is looking for, and the count line says when it has been cut. */
export const ROW_HISTORY_LIMIT = 40;

/**
 * How to find one row's history.
 *
 * ★★★ TWO SHAPES, BECAUSE THE EIGHT TABLES HAVE TWO KINDS OF KEY AND ONLY ONE OF
 *     THEM CAN BE SPELLED AS A STRING SAFELY.
 *
 *   · `rowId` — a single-column key (`id`, or `app_config.key`). The trigger
 *     writes the bare value, byte-identical to what fix-520 wrote, so this also
 *     finds the 22,381 `projects` rows that predate fix-590.
 *
 *   · `rowKey` — a COMPOSITE key (`permit_type_defaults` is
 *     `(tenant_id, type)`). ⚠️ **Do not try to rebuild the string.** The trigger
 *     stores composite identity as jsonb text, and jsonb normalises key order by
 *     LENGTH and then bytewise — so `(tenant_id, type)` serialises as
 *     `{"type": …, "tenant_id": …}`, the reverse of the index order. Reproducing
 *     that in TypeScript would be encoding a Postgres internal into the client,
 *     and it would break silently the day a key column is renamed to something a
 *     different length. **So the lookup is a jsonb CONTAINMENT filter on
 *     `row_key`**, which is order-independent by construction. This is the
 *     brief's *"assert the round trip, not the string"* taken as a design
 *     instruction rather than a test instruction.
 */
export interface RowHistoryTarget {
  table: string;
  rowId?: string | null;
  rowKey?: Record<string, string> | null;
}

export function useRowHistory(target: RowHistoryTarget | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const table = target?.table ?? '';
  const rowId = target?.rowId ?? '';
  const rowKey = target?.rowKey ?? null;
  // ★ The cache key carries whichever identity was used, sorted, so the two
  //   shapes cannot collide and a composite key's key order cannot split the
  //   cache into two entries for one row.
  const keyPart = rowId !== '' ? rowId : stableKeyPart(rowKey);
  const q = useQuery<AuditLogRow[]>({
    queryKey: queryKeys.rowHistory(tenantId ?? '', table, keyPart),
    enabled: !!tenantId && table !== '' && keyPart !== '',
    // ★ The panel is opened deliberately and read once. No streaming — see the
    //   note on `rowHistoryAll` in queryKeys for why.
    staleTime: 30_000,
    queryFn: async () => {
      let builder = supabase
        .from('audit_log')
        // ★ An EXPLICIT select list. fix-386/410/461/467/562 are why this comment
        //   exists: a column added to the table is INVISIBLE until it is named
        //   here, with no error. `row_key` is fix-590's own column and the
        //   restore path needs it, so its absence would be silent.
        .select('id, created_at, user_id, action, table_name, row_id, row_key, changes')
        .eq('table_name', table);
      builder =
        rowId !== ''
          ? builder.eq('row_id', rowId)
          : builder.contains('row_key', rowKey as Record<string, string>);
      const { data, error } = await builder
        // ★ `id DESC`, not `created_at DESC`: fix-338 established that several
        //   audit rows routinely share a created_at to the microsecond and only
        //   `id` breaks the tie deterministically.
        .order('id', { ascending: false })
        .limit(ROW_HISTORY_LIMIT);
      if (error) {
        // ★★★ THE MIGRATION IS STAGED. Until Bobby applies it there is no
        //     `row_key` column, and PostgREST answers a missing column with
        //     42703. That is "not switched on yet", not a failure to report — so
        //     it degrades to an empty history rather than an error panel.
        if (isMissingSchema(error)) return [];
        throw error;
      }
      return (data ?? []) as unknown as AuditLogRow[];
    },
  });
  const entries: HistoryEntry[] = (q.data ?? []).map(toHistoryEntry);
  return { ...q, entries };
}

/**
 * The deleted rows of one quarter's layout — what the whole-quarter restore
 * offers to put back.
 *
 * ★★★ THIS IS THE ORIGIN CASE. Bobby's twelve columns did not change; they
 *     vanished. So the question the screen has to answer is not *"what changed"*
 *     but *"what is missing"*, and that is a different query: the newest entry
 *     per row, kept only where it is a delete.
 */
export function useDeletedQuarterLayout(quarter: string | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<AuditLogRow[]>({
    queryKey: queryKeys.quarterLayoutDeleted(tenantId ?? '', quarter ?? ''),
    enabled: !!tenantId && !!quarter,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, created_at, user_id, action, table_name, row_id, row_key, changes')
        .eq('table_name', 'draw_schedule_quarter_layout')
        .order('id', { ascending: false })
        .limit(500);
      if (error) {
        if (isMissingSchema(error)) return [];
        throw error;
      }
      const rows = (data ?? []) as unknown as AuditLogRow[];
      // ★ The quarter filter is applied HERE rather than in the query because it
      //   lives inside `changes -> quarter -> before`, and a jsonb path filter in
      //   PostgREST would have to be spelled as a string nobody can grep for. 500
      //   rows is the whole table's history several times over (104 live rows).
      const forQuarter = rows.filter(
        (r) =>
          r.changes?.quarter?.before === quarter ||
          r.changes?.quarter?.after === quarter,
      );
      // Newest entry per row wins; keep it only if that entry is a delete.
      const newest = new Map<string, AuditLogRow>();
      for (const r of forQuarter) {
        const key = r.row_id ?? JSON.stringify(r.row_key);
        if (!newest.has(key)) newest.set(key, r);
      }
      return Array.from(newest.values()).filter((r) => r.action.endsWith('_deleted'));
    },
  });
  return { ...q, deleted: (q.data ?? []).map(toHistoryEntry) };
}

/** A composite key as a stable cache-key fragment. ★ Sorted by column name, so
 *  the caller's object literal order cannot split one row's cache in two. */
export function stableKeyPart(rowKey: Record<string, string> | null): string {
  if (!rowKey) return '';
  const keys = Object.keys(rowKey).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${rowKey[k]}`).join('&');
}

/** ★ PostgREST's codes for "that column does not exist" (42703) and "that
 *  function does not exist" (PGRST202 / 42883) — i.e. the migration is staged. */
function isMissingSchema(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code ?? '');
  const msg = String((error as { message?: unknown }).message ?? '');
  return (
    code === '42703' ||
    code === '42883' ||
    code === 'PGRST202' ||
    /does not exist|Could not find/i.test(msg)
  );
}

/**
 * Put one prior version back.
 *
 * ★★★ RESTORING IS ITSELF AN AUDITED WRITE, and not because this hook does
 *     anything about it: the RPC's UPDATE (or INSERT) fires the same trigger as
 *     any other change, so the restore appears in the history it just read from.
 *     It is not a rewind; it is a new change that happens to reinstate old
 *     values. Otherwise the restore would be the one write with no history.
 *
 * ★★ THE PERMISSION CHECK IS THE POLICY THAT ALREADY EXISTS. The function is
 *    SECURITY INVOKER, so `team_members`' `is_tenant_admin` and the quarter
 *    layout's `may_edit_draw_schedule` decide — nothing here re-derives them.
 *    A refusal comes back as 42501 and is shown in words.
 */
export function useRestoreAuditedRow() {
  const qc = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation({
    meta: { write: 'bp_restore_audited_row' },
    mutationFn: async (input: { auditId: number; table: string }) => {
      const { data, error } = await supabase.rpc('bp_restore_audited_row', {
        p_audit_id: input.auditId,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { out_table: string; out_row_id: string; out_columns: string[]; out_created: boolean }
        | undefined;
      return row ?? null;
    },
    onSuccess: (row, input) => {
      const n = row?.out_columns?.length ?? 0;
      pushToast(
        row?.out_created
          ? 'Restored — the record was re-created.'
          : `Restored ${n} field${n === 1 ? '' : 's'}.`,
        'success',
      );
      // ★ The history itself, plus whatever list renders the restored row. Both
      //   bare prefixes, so every quarter / roster / config cache refreshes.
      void qc.invalidateQueries({ queryKey: queryKeys.rowHistoryAll });
      void qc.invalidateQueries({ queryKey: [input.table] });
      void qc.invalidateQueries({ queryKey: queryKeys.drawScheduleQuarterLayoutAll });
      void qc.invalidateQueries({ queryKey: queryKeys.teamMembers(tenantId) });
      void qc.invalidateQueries({ queryKey: queryKeys.appConfigAll });
    },
    onError: (error: Error) => {
      pushToast(restoreFailureMessage(error), 'error');
    },
  });
}

/** Put every deleted row of one quarter back, in one action. */
export function useRestoreDeletedQuarterLayout() {
  const qc = useQueryClient();
  return useMutation({
    meta: { write: 'bp_restore_deleted_quarter_layout' },
    mutationFn: async (input: { quarter: string }) => {
      const { data, error } = await supabase.rpc('bp_restore_deleted_quarter_layout', {
        p_quarter: input.quarter,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { out_restored: number; out_audit_ids: number[] }
        | undefined;
      return row ?? null;
    },
    onSuccess: (row, input) => {
      const n = row?.out_restored ?? 0;
      pushToast(
        n === 0
          ? `Nothing to restore — no rows of ${input.quarter} were deleted.`
          : `Restored ${n} column${n === 1 ? '' : 's'} to ${input.quarter}.`,
        n === 0 ? 'info' : 'success',
      );
      void qc.invalidateQueries({ queryKey: queryKeys.rowHistoryAll });
      void qc.invalidateQueries({ queryKey: queryKeys.drawScheduleQuarterLayoutAll });
    },
    onError: (error: Error) => {
      pushToast(restoreFailureMessage(error), 'error');
    },
  });
}

/**
 * ★★ THE RPC ALREADY SPEAKS ENGLISH, so its message is passed through rather
 *    than replaced — it is the one place that knows whether the row was missing,
 *    the entry was a creation, or the policy refused. What this adds is the one
 *    case the RPC cannot describe: it is not deployed yet.
 */
export function restoreFailureMessage(error: unknown): string {
  if (isMissingSchema(error)) {
    return 'Restoring is not switched on yet — the history migration has not been applied.';
  }
  const msg = String((error as { message?: unknown })?.message ?? '').trim();
  return msg === '' ? 'Could not restore that version.' : msg;
}
