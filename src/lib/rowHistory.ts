// ===========================================================================
// ★★★ fix-590 — THE WORK YOU ARRANGED BY HAND, AND GETTING IT BACK
// ===========================================================================
//
// **2026-09-16.** Bobby's hand-arranged Q4 2025 draw-schedule layout — twelve
// columns, two DM groups — was not in the tool, and he found out eleven months
// later from a screenshot of the original spreadsheet.
//
// ★★★ THE THING THAT COULD NOT BE ANSWERED was whether it had been deleted or
//     never saved. `draw_schedule_quarter_layout` had no history, so those two
//     were the same observation. He rebuilt it from a picture.
//
//   *"That sucks and we need a way to quickly restore areas like this
//    negatively impacted by updates."*
//
// ★★★ THE PATTERN WAS BACKWARDS. The tables the system writes constantly had
//     history; the tables a PERSON arranges by hand — where one bad write costs
//     an afternoon and nobody notices for months — had none.
//
// This module is the CLIENT half and the SPECIFICATION half: the vocabulary the
// history panel renders, and the table set a test holds the migration to. The
// recording itself is `migrations/fix_590_hand_arranged_history.sql`.

/**
 * The eight tables a person arranges by hand, which had no history at all.
 *
 * ★★★ THIS LIST IS THE CENSUS. `RowHistoryFix590` asserts that every member has
 *     an `AFTER INSERT OR UPDATE OR DELETE` trigger in the migration — so adding
 *     a ninth table here without wiring it up fails a test rather than shipping a
 *     silent hole. That is the failure mode this whole ticket is about.
 *
 * ★★ ORDER IS THE BRIEF'S: by how much a wrong value costs, not alphabetically.
 *    `permits` and `permit_cycles` lead because they hold every submitted /
 *    corrections / resubmitted date the team manages to, and a wrong one is
 *    invisible until somebody misses a deadline. They were the surprise — the
 *    ticket started from a config table.
 */
export const HAND_ARRANGED_TABLES = [
  'permits',
  'permit_cycles',
  'draw_schedule_quarter_layout',
  'task_templates',
  'team_members',
  'app_config',
  'permit_type_defaults',
  'da_team_routing',
] as const;

export type HandArrangedTable = (typeof HAND_ARRANGED_TABLES)[number];

/**
 * Everything `bp_audit_row` is attached to — the eight plus `projects`.
 *
 * ★★★ `projects` IS HERE BECAUSE ITS AUDIT HAD THE SAME HOLE. fix-520's trigger
 *     fired on **UPDATE only**, so a deleted project left no trace and neither
 *     did a created one — and **absence is exactly the shape that hurt Bobby.**
 *     The one table that had an audit could not have answered the question this
 *     ticket exists to answer.
 */
export const AUDITED_TABLES = [...HAND_ARRANGED_TABLES, 'projects'] as const;

/**
 * The tables a person can restore FROM THE SCREEN today.
 *
 * ★★★ THE LINE THIS TICKET DREW, AND WHY. §2 permits it in as many words —
 *     *"`permits` and `permit_cycles` get the RECORDING now; their restore UI can
 *     follow"* — and the reason is not effort. **A permit's dates are also
 *     written by the scraper every night**, so "put the old value back" on a
 *     permit needs a ruling about what happens on the next scrape: does the
 *     restore stick, or does the portal overwrite it by morning? That is Bobby's
 *     ruling, not mine, and shipping a restore button that quietly loses its
 *     effect overnight would be worse than not shipping one.
 *
 * ★ Mirrors `bp_restorable_tables()` in the migration. The SQL is the authority —
 *   it is what refuses the write — and a test asserts the two lists match.
 */
export const RESTORABLE_TABLES = [
  'draw_schedule_quarter_layout',
  'team_members',
  'permit_type_defaults',
  'app_config',
  'task_templates',
  'da_team_routing',
] as const;

export type RestorableTable = (typeof RESTORABLE_TABLES)[number];

export function isRestorableTable(table: string): table is RestorableTable {
  return (RESTORABLE_TABLES as readonly string[]).includes(table);
}

// ---------------------------------------------------------------------------
// The shape `audit_log` hands back
// ---------------------------------------------------------------------------

/** One `{before, after}` pair, as `bp_audit_row` writes it. */
export interface HistoryChange {
  before: unknown;
  after: unknown;
}

export interface AuditLogRow {
  id: number;
  created_at: string;
  user_id: string | null;
  action: string;
  table_name: string;
  row_id: string | null;
  /** ★ fix-590: the row's PRIMARY KEY as `{column: value}`. Null on the 22,381
   *  rows written before this ticket, which is why `restorable` can be false. */
  row_key: Record<string, unknown> | null;
  changes: Record<string, HistoryChange> | null;
}

export type HistoryOp = 'inserted' | 'updated' | 'deleted';

/**
 * Which of the three happened.
 *
 * ★★ READ OFF THE SUFFIX, WHICH THE TRIGGER OWNS. `bp_audit_row` writes
 *    `<noun>_inserted` / `_updated` / `_deleted`, and the noun is a trigger
 *    argument so `projects` keeps the exact `project_updated` string its 22,381
 *    existing rows use. Matching the suffix rather than the whole string is what
 *    makes both generations readable by one function.
 *
 * ★ `null` for anything else — `audit_log` holds 44 distinct actions, most of
 *   them the scraper's, and this panel must not pretend to explain them.
 */
export function historyOp(action: string): HistoryOp | null {
  if (action.endsWith('_inserted')) return 'inserted';
  if (action.endsWith('_updated')) return 'updated';
  if (action.endsWith('_deleted')) return 'deleted';
  return null;
}

/** The columns an entry touched, in a stable order. ★ `updated_at` is never
 *  among them — the trigger skips it, which is fix-520's rule kept. */
export function changedColumns(row: AuditLogRow): string[] {
  return Object.keys(row.changes ?? {})
    .filter((k) => k !== 'updated_at')
    .sort();
}

/**
 * Why this entry cannot be put back, or `null` when it can.
 *
 * ★★★ IT MIRRORS THE RPC'S REFUSALS, IN THE RPC'S ORDER, so the button is absent
 *     for exactly the reasons the server would refuse — and the person is told
 *     before they click rather than after. The SQL is still the authority: it
 *     re-checks every one of these, because a client that had drifted would
 *     otherwise be able to ask for something the server then has to reject.
 *
 * ★★ WHAT IS **NOT** CHECKED HERE: whether the person is allowed to write that
 *    row. That is RLS, the function is SECURITY INVOKER, and the answer is the
 *    policy that already exists — re-deriving `is_tenant_admin` in TypeScript
 *    would be a second writer of one rule.
 */
export function restoreBlockedReason(row: AuditLogRow): string | null {
  if (!isRestorableTable(row.table_name)) {
    return 'History for this record is recorded but not restorable from here yet.';
  }
  if (historyOp(row.action) === 'inserted') {
    // ★★★ An INSERT's `before` is null on every column, so "restore" would mean
    //     DELETING the row. That is a different action with a different meaning
    //     and nobody asked for it.
    return 'This is the record being created — there is no earlier version.';
  }
  if (!row.row_key || Object.keys(row.row_key).length === 0) {
    return 'This entry predates history tracking, so the record cannot be found automatically.';
  }
  if (changedColumns(row).length === 0) {
    return 'This entry records no values to put back.';
  }
  return null;
}

export function canRestore(row: AuditLogRow): boolean {
  return restoreBlockedReason(row) === null;
}

// ---------------------------------------------------------------------------
// Rendering one value
// ---------------------------------------------------------------------------

/**
 * A jsonb value as a person should read it.
 *
 * ★★ `null` AND `''` ARE DIFFERENT AND BOTH HAVE TO SHOW. "Nobody typed one" and
 *    "somebody cleared it" are different events, and a history panel that
 *    printed both as blank would lose the distinction it exists to preserve —
 *    which is this ticket's whole theme one level down.
 * ★ An object or array is printed as compact JSON rather than `[object Object]`:
 *   `app_config.value` and `projects.unit_types` are both jsonb, and they are
 *   exactly the values somebody wants to compare.
 */
export function formatHistoryValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '(blank)' : v;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** ★ Long jsonb truncates, because a 40-unit `unit_types` blob would push the
 *  rest of the row off the panel. The full value is in the `title`. */
export const HISTORY_VALUE_MAX = 80;

export function truncateHistoryValue(s: string): string {
  return s.length <= HISTORY_VALUE_MAX ? s : `${s.slice(0, HISTORY_VALUE_MAX - 1)}…`;
}

// ---------------------------------------------------------------------------
// Who did it
// ---------------------------------------------------------------------------

/**
 * ★★★ §3: RECORD THE SCRAPER'S WRITES TOO, AND MARK THEM. `auth.uid()` is null
 *     for the scraper — **that is the signal, and it is already
 *     distinguishable** — so no column was added for it. 1,297 of the 3,030
 *     audit rows written in the seven days to 2026-09-29 already have no actor.
 *     ⛔ These rows are NOT filtered out: *"what did the scraper change on this
 *     permit overnight"* is a question Bobby has asked in other words more than
 *     once.
 *
 * ★★ AND IT SAYS "the overnight scrape", NOT "unknown". A null actor is a FACT
 *    about which writer it was, not missing information — calling it unknown
 *    would throw away the one thing the null tells you. The other machine writer
 *    is a migration, and those are rare enough that naming the common case is
 *    the honest default.
 */
export const MACHINE_ACTOR_LABEL = 'the overnight scrape or a migration';

export function actorLabel(
  userId: string | null,
  nameFor: (id: string) => string | null,
): string {
  if (!userId) return MACHINE_ACTOR_LABEL;
  return nameFor(userId) ?? 'somebody no longer on the roster';
}

export function isMachineWrite(row: AuditLogRow): boolean {
  return row.user_id === null;
}

// ---------------------------------------------------------------------------
// One entry, ready to render
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: number;
  createdAt: string;
  op: HistoryOp | null;
  /** The columns that moved, with their before/after already formatted. */
  fields: { column: string; before: string; after: string; rawBefore: unknown; rawAfter: unknown }[];
  machine: boolean;
  blockedReason: string | null;
  raw: AuditLogRow;
}

/**
 * Turn an `audit_log` row into what the panel draws.
 *
 * ★ Entries whose action this module does not recognise are kept, not dropped:
 *   `historyOp` returns null and the panel shows the action verbatim. A history
 *   that silently omitted rows would be the original defect in miniature.
 */
export function toHistoryEntry(row: AuditLogRow): HistoryEntry {
  const changes = row.changes ?? {};
  return {
    id: row.id,
    createdAt: row.created_at,
    op: historyOp(row.action),
    fields: changedColumns(row).map((column) => {
      const c = changes[column] ?? { before: null, after: null };
      return {
        column,
        before: truncateHistoryValue(formatHistoryValue(c.before)),
        after: truncateHistoryValue(formatHistoryValue(c.after)),
        rawBefore: c.before,
        rawAfter: c.after,
      };
    }),
    machine: isMachineWrite(row),
    blockedReason: restoreBlockedReason(row),
    raw: row,
  };
}

/**
 * ★★★ THE SENTENCE FOR AN EMPTY HISTORY, WHICH IS THE OTHER HALF OF THE FIX.
 *
 *     §0's injury was *"I could not tell him whether it had been deleted or never
 *     saved"* — before this ticket those were the same observation. They are
 *     different now, and when the answer is "never saved" **there is nothing to
 *     put back and the screen has to say so.** A restore that invented a layout
 *     would be worse than the gap it filled.
 *
 * ★ It names the start date, because "no history" means two things for a while
 *   yet: nothing happened, or it happened before recording began.
 */
export function emptyHistoryLine(recordingSince: string | null): string {
  return recordingSince
    ? `No changes recorded since ${recordingSince}. Anything earlier than that was not being tracked — it cannot be told apart from never having been saved.`
    : 'No changes recorded for this record yet.';
}
