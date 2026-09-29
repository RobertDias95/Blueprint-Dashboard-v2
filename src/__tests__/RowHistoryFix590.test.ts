import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUDITED_TABLES,
  HAND_ARRANGED_TABLES,
  RESTORABLE_TABLES,
  actorLabel,
  canRestore,
  changedColumns,
  emptyHistoryLine,
  formatHistoryValue,
  historyOp,
  isMachineWrite,
  isRestorableTable,
  restoreBlockedReason,
  toHistoryEntry,
  truncateHistoryValue,
  type AuditLogRow,
} from '../lib/rowHistory';

// ===========================================================================
// ★★★ fix-590 — THE WORK YOU ARRANGED BY HAND, AND GETTING IT BACK
// ===========================================================================
//
// **2026-09-16.** Bobby's hand-arranged Q4 2025 draw-schedule layout — twelve
// columns, two DM groups — was not in the tool. He found out eleven months later
// from a screenshot of the original spreadsheet, and **it could not be said
// whether it had been deleted or never saved**, because
// `draw_schedule_quarter_layout` had no history and those two are the same
// observation.
//
//   *"That sucks and we need a way to quickly restore areas like this
//    negatively impacted by updates."*
//
// ---------------------------------------------------------------------------
// NO LIVE DB IN CI — so this is a pure-TS MIRROR of the trigger plus a text
// assertion tying the mirror to the SQL, the fix-153 / fix-382 / fix-425 pattern
// this repo already uses. The migration is STAGED and unapplied; a test below
// keeps it that way.
// ---------------------------------------------------------------------------

const SQL = readFileSync(
  resolve(process.cwd(), 'migrations/fix_590_hand_arranged_history.sql'),
  'utf8',
);
/** ★ Comments stripped before asserting behaviour, because this file's SQL is
 *  mostly prose and a `--` line mentioning `AFTER INSERT` would satisfy an
 *  assertion about the trigger. The comment-stripping trap, recorded seven times
 *  in this Brain. */
const CODE = SQL.replace(/^\s*--.*$/gm, '');

// ---------------------------------------------------------------------------
// ★★★ THE MIRROR — `bp_audit_row`, in TypeScript
// ---------------------------------------------------------------------------

type Op = 'INSERT' | 'UPDATE' | 'DELETE';
type Row = Record<string, unknown>;

interface AuditWrite {
  tenant_id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  row_id: string;
  row_key: Record<string, unknown>;
  changes: Record<string, { before: unknown; after: unknown }>;
}

/**
 * `bp_audit_row`, mirrored.
 *
 * ★★★ `pkCols` IS AN ARGUMENT HERE AND A CATALOGUE LOOKUP THERE. The SQL derives
 *     it from `pg_index` so attaching the trigger to a ninth table needs no
 *     thought (the brief's ★); the mirror takes it as data so a test can drive
 *     all three key shapes. The text assertions below pin the derivation.
 */
function auditRow(
  op: Op,
  table: string,
  pkCols: string[],
  oldRow: Row | null,
  newRow: Row | null,
  actor: string | null,
  noun?: string,
): AuditWrite | null {
  const subject = newRow ?? oldRow;
  if (!subject) return null;
  if (pkCols.length === 0) return null; // no PK → nothing could find it again

  const rowKey: Record<string, unknown> = {};
  for (const c of pkCols) rowKey[c] = subject[c];
  // ★ Single key → the bare value, byte-identical to fix-520's `NEW.id::text`.
  //   Composite → the jsonb text.
  const rowId =
    pkCols.length === 1 ? String(subject[pkCols[0]]) : JSON.stringify(rowKey);

  const tenant = subject.tenant_id;
  if (typeof tenant !== 'string' || tenant === '') return null;

  const n = noun ?? table;
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (op === 'UPDATE') {
    for (const k of Object.keys(newRow!)) {
      if (k === 'updated_at') continue;
      if (!same(oldRow![k], newRow![k])) {
        changes[k] = { before: oldRow![k], after: newRow![k] };
      }
    }
    // fix-520's rule, kept: a no-op UPDATE records nothing.
    if (Object.keys(changes).length === 0) return null;
  } else if (op === 'INSERT') {
    for (const k of Object.keys(newRow!)) {
      if (k === 'updated_at') continue;
      changes[k] = { before: null, after: newRow![k] };
    }
  } else {
    for (const k of Object.keys(oldRow!)) {
      if (k === 'updated_at') continue;
      changes[k] = { before: oldRow![k], after: null };
    }
  }

  return {
    tenant_id: tenant,
    user_id: actor,
    action: `${n}_${op === 'INSERT' ? 'inserted' : op === 'UPDATE' ? 'updated' : 'deleted'}`,
    table_name: table,
    row_id: rowId,
    row_key: rowKey,
    changes,
  };
}

/** `IS DISTINCT FROM` over jsonb values. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const T = '00000000-0000-0000-0000-000000000001';

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 §1 — one row changed, one audit row, naming what moved', () => {
  it('★★★ exactly one row, naming the columns that moved and nothing else', () => {
    const before = { id: 7, tenant_id: T, intake_to_approval_days: 120, c1_offset_days: 40, updated_at: 'a' };
    const after = { ...before, intake_to_approval_days: 150, updated_at: 'b' };
    const w = auditRow('UPDATE', 'permit_type_defaults', ['tenant_id', 'type'], before, after, 'u1')!;
    expect(Object.keys(w.changes)).toEqual(['intake_to_approval_days']);
    expect(w.changes.intake_to_approval_days).toEqual({ before: 120, after: 150 });
    // ★ `updated_at` is never recorded — fix-520's rule, and it is why a save
    //   that only bumped the OCC stamp is not a change.
    expect(w.changes.updated_at).toBeUndefined();
  });

  it('★★★ a NO-OP update produces none — fix-520\'s rule, kept', () => {
    const r = { id: 1, tenant_id: T, name: 'Cam', updated_at: 'a' };
    expect(auditRow('UPDATE', 'team_members', ['id'], r, { ...r, updated_at: 'b' }, 'u1')).toBeNull();
  });

  it('★★★ an INSERT is recorded and carries the WHOLE row', () => {
    const r = { id: 9, tenant_id: T, name: 'Ana', role: 'da', active: true, updated_at: 'a' };
    const w = auditRow('INSERT', 'team_members', ['id'], null, r, 'u1')!;
    expect(w.action).toBe('team_members_inserted');
    expect(Object.keys(w.changes).sort()).toEqual(['active', 'id', 'name', 'role', 'tenant_id']);
    // ★ Same `{before, after}` shape as an UPDATE, with `before: null`.
    expect(w.changes.name).toEqual({ before: null, after: 'Ana' });
  });

  it('★★★ a DELETE is recorded and carries the whole row, so "this used to exist" is answerable', () => {
    const r = { id: 9, tenant_id: T, quarter: '2025-Q4', position: 3, da_name: 'Marc', updated_at: 'a' };
    const w = auditRow('DELETE', 'draw_schedule_quarter_layout', ['id'], r, null, 'u1')!;
    expect(w.action).toBe('draw_schedule_quarter_layout_deleted');
    expect(w.changes.da_name).toEqual({ before: 'Marc', after: null });
    // ★★★ THIS IS THE PROPERTY THE RESTORE RESTS ON: a DELETE's entry already
    //     holds every value needed to re-create the row, so "put it back" is
    //     "set every column to its `before`" with no special case.
    expect(w.changes.quarter.before).toBe('2025-Q4');
    expect(w.changes.position.before).toBe(3);
  });

  it('★★★ a DELETE on `projects` is recorded — THE REGRESSION THE TICKET IS NAMED AFTER', () => {
    // fix-520's trigger fired on UPDATE only, so this produced NOTHING, and
    // **absence is exactly the shape that hurt Bobby.**
    const r = { id: 'p-1', tenant_id: T, address: '4707 S Graham St', updated_at: 'a' };
    const w = auditRow('DELETE', 'projects', ['id'], r, null, 'u1', 'project')!;
    expect(w.action).toBe('project_deleted');
    expect(w.changes.address.before).toBe('4707 S Graham St');
  });

  it('★★★ `projects` keeps its EXACT existing action string on update', () => {
    // 22,381 audit rows already say `project_updated`. The noun is a trigger
    // argument precisely so the new function does not rename them.
    const r = { id: 'p-1', tenant_id: T, zone: 'LR1', updated_at: 'a' };
    const w = auditRow('UPDATE', 'projects', ['id'], r, { ...r, zone: 'LR2' }, 'u1', 'project')!;
    expect(w.action).toBe('project_updated');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 §1 — the three key shapes, and the ROUND TRIP', () => {
  it('★★ a single `id` key writes the bare value, as fix-520 did', () => {
    const r = { id: 42, tenant_id: T, name: 'x', updated_at: 'a' };
    const w = auditRow('DELETE', 'team_members', ['id'], r, null, null)!;
    expect(w.row_id).toBe('42');
    expect(w.row_key).toEqual({ id: 42 });
  });

  it('★★ a TEXT key (`app_config.key`) identifies the row', () => {
    const r = { key: 'projectTagOptions', tenant_id: T, value: ['ECA'], updated_at: 'a' };
    const w = auditRow('UPDATE', 'app_config', ['key'], r, { ...r, value: ['ECA', 'HVL'] }, 'u1')!;
    expect(w.row_id).toBe('projectTagOptions');
    expect(w.row_key).toEqual({ key: 'projectTagOptions' });
  });

  it('★★★ a COMPOSITE key round-trips — asserted as the ROUND TRIP, not the string', () => {
    // The brief's own instruction. `permit_type_defaults` is `(tenant_id, type)`.
    const r = { tenant_id: T, type: 'ULS', intake_to_approval_days: 120, updated_at: 'a' };
    const w = auditRow('UPDATE', 'permit_type_defaults', ['tenant_id', 'type'], r,
      { ...r, intake_to_approval_days: 150 }, 'u1')!;
    // ★★★ THE ROUND TRIP: whatever the serialisation, `row_key` finds the row
    //     again — every key column present, with its value.
    expect(w.row_key).toEqual({ tenant_id: T, type: 'ULS' });
    for (const col of ['tenant_id', 'type']) {
      expect(Object.keys(w.row_key)).toContain(col);
      expect(w.row_key[col]).toBe(r[col as keyof typeof r]);
    }
    // ⚠️ AND THE STRING IS NOT ASSERTED, deliberately. Postgres normalises jsonb
    //    key order by LENGTH then bytewise, so the real `row_id` is
    //    `{"type": …, "tenant_id": …}` — the REVERSE of the index order this
    //    mirror produces. Pinning either spelling would encode a Postgres
    //    internal into a test; the client never rebuilds it either, it filters
    //    `row_key` by containment. That is why the assertion above is the shape.
    expect(Object.keys(JSON.parse(w.row_id)).sort()).toEqual(['tenant_id', 'type']);
  });

  it('★ a row with no tenant, or no primary key, is not recorded', () => {
    expect(auditRow('UPDATE', 'x', ['id'], { id: 1 }, { id: 1, a: 2 }, 'u')).toBeNull();
    expect(auditRow('UPDATE', 'x', [], { tenant_id: T }, { tenant_id: T, a: 2 }, 'u')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 §3 — the scraper is recorded, and marked', () => {
  it('★★★ a scraper write is recorded and distinguishable (`auth.uid()` null)', () => {
    const r = { id: 5, tenant_id: T, submitted: null, updated_at: 'a' };
    const w = auditRow('UPDATE', 'permit_cycles', ['id'], r, { ...r, submitted: '2026-09-28' }, null)!;
    // ⛔ NOT filtered out — *"what did the scraper change on this permit
    //    overnight"* is the question.
    expect(w.changes.submitted).toEqual({ before: null, after: '2026-09-28' });
    expect(w.user_id).toBeNull();
    expect(isMachineWrite(asAuditRow(w))).toBe(true);
  });

  it('★★ and a person\'s write is not marked', () => {
    const r = { id: 5, tenant_id: T, submitted: null, updated_at: 'a' };
    const w = auditRow('UPDATE', 'permit_cycles', ['id'], r, { ...r, submitted: '2026-09-28' }, 'u1')!;
    expect(isMachineWrite(asAuditRow(w))).toBe(false);
  });

  it('★★ a null actor reads as WHICH machine, not as "unknown"', () => {
    // A null `user_id` is a FACT about the writer, not missing information.
    expect(actorLabel(null, () => null)).toMatch(/scrape|migration/i);
    expect(actorLabel('u1', () => 'Cam')).toBe('Cam');
    expect(actorLabel('u1', () => null)).toMatch(/no longer on the roster/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 §2 — restore, and what it refuses', () => {
  const base = (over: Partial<AuditLogRow> = {}): AuditLogRow => ({
    id: 1,
    created_at: '2026-09-28T10:00:00Z',
    user_id: 'u1',
    action: 'draw_schedule_quarter_layout_deleted',
    table_name: 'draw_schedule_quarter_layout',
    row_id: '9',
    row_key: { id: 9 },
    changes: { da_name: { before: 'Marc', after: null } },
    ...over,
  });

  it('★★★ a deleted hand-arranged row can be put back', () => {
    expect(canRestore(base())).toBe(true);
    expect(restoreBlockedReason(base())).toBeNull();
  });

  it('★★★ an INSERT entry is refused — there is no earlier version', () => {
    // Its `before` is null on every column, so "restore" would mean DELETING the
    // row: a different action with a different meaning that nobody asked for.
    const r = base({ action: 'team_members_inserted', table_name: 'team_members' });
    expect(canRestore(r)).toBe(false);
    expect(restoreBlockedReason(r)).toMatch(/being created/i);
  });

  it('★★★ an entry with no `row_key` is refused rather than parsed out of `row_id`', () => {
    // The 22,381 rows written before fix-590. A parser over somebody's data is
    // where the next bug lives — a jurisdiction called `a&b` breaks a `&`-joined
    // key — so this refuses and says why.
    const r = base({ row_key: null });
    expect(canRestore(r)).toBe(false);
    expect(restoreBlockedReason(r)).toMatch(/predates/i);
  });

  it('★★★ `permits` and `permit_cycles` are RECORDED but not restorable — the line drawn', () => {
    // §2 permits exactly this. The reason is not effort: a permit's dates are
    // also written by the scraper every night, so "put the old value back" needs
    // a ruling about what happens on the next scrape. That ruling is Bobby's.
    for (const t of ['permits', 'permit_cycles', 'projects']) {
      expect(AUDITED_TABLES as readonly string[]).toContain(t);
      expect(isRestorableTable(t)).toBe(false);
      expect(restoreBlockedReason(base({ table_name: t }))).toMatch(/not restorable from here yet/i);
    }
  });

  it('★★ an entry carrying no columns is refused', () => {
    expect(restoreBlockedReason(base({ changes: {} }))).toMatch(/no values to put back/i);
  });

  it('★★★ the client\'s refusals mirror the SQL\'s, and the SQL still re-checks them', () => {
    // A client that had drifted must not be able to ask for something the server
    // then has to reject — so both hold the rule and the SQL is the authority.
    expect(CODE).toContain('there is no earlier version to restore');
    expect(CODE).toContain('predates history tracking');
    expect(CODE).toContain('cannot be restored from here yet');
    expect(CODE).toContain('records no column values to put back');
  });

  it('★★★ a restore by somebody who cannot write that row is refused, and says so', () => {
    // ★★★ THE PERMISSION CHECK IS THE POLICY THAT ALREADY EXISTS. The function is
    //     SECURITY INVOKER, so `team_members`' `is_tenant_admin` and the quarter
    //     layout's `may_edit_draw_schedule` decide — nothing re-derives them,
    //     which is the two-writers defect this Brain has removed six times.
    expect(CODE).toContain('SECURITY INVOKER');
    expect(CODE).toContain('You do not have permission to change this record.');
    expect(CODE).toContain('You do not have permission to restore this record.');
    expect(CODE).toContain("ERRCODE = '42501'");
  });

  it('★★★ the row IDENTITY comes from `row_key`, never from `changes` — THE PROBE\'S BUG', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // ★★★ FOUND BY A ROLLED-BACK PROD PROBE, NOT BY READING IT BACK.
    // ═══════════════════════════════════════════════════════════════════════
    //
    // The first version built the `WHERE` out of the before-VALUES. That works
    // for a DELETE entry, which carries every column — and **fails silently for
    // an UPDATE entry, which carries only the columns that moved.** On
    // `permit_type_defaults` the entry held `{intake_to_approval_days}` and
    // nothing else, so both key columns came back NULL, the row "did not exist",
    // and the function took the RE-CREATE branch:
    //
    //   ERROR: null value in column "tenant_id" violates not-null constraint
    //   INSERT INTO permit_type_defaults (intake_to_approval_days) SELECT …
    //
    // ★★★ A DELETE-ONLY TEST WOULD HAVE PASSED. That is the whole lesson: the two
    //     ops carry different amounts of the row, so the identity has to come
    //     from the field that always holds all of it.
    //
    // The `$2` binding IS the fix, asserted here so it cannot quietly become `$1`
    // again.
    expect(CODE).toContain('jsonb_populate_record(NULL::public.%I, $2) r');
    expect(CODE).toMatch(/INTO v_exists USING v_before, v_rec\.row_key/);
    expect(CODE).toMatch(/\) USING v_before, v_rec\.row_key;/);
    // ★ And the re-create path uses key ∪ values, so the PK is never missing.
    expect(CODE).toContain('v_full := v_rec.row_key || v_before');
    expect(CODE).toMatch(/jsonb_object_keys\(v_full\)/);
  });

  it('★★★ an UPDATE entry carries ONLY the moved column — which is why the above matters', () => {
    // The mirror proves the premise the bug rested on, so the two tests are one
    // argument: an UPDATE's `changes` cannot identify its own row.
    const before = { tenant_id: T, type: 'ULS', intake_to_approval_days: 120, updated_at: 'a' };
    const w = auditRow('UPDATE', 'permit_type_defaults', ['tenant_id', 'type'], before,
      { ...before, intake_to_approval_days: 150 }, 'u1')!;
    expect(Object.keys(w.changes)).toEqual(['intake_to_approval_days']);
    // ★★★ NEITHER key column is in `changes` …
    expect(w.changes.tenant_id).toBeUndefined();
    expect(w.changes.type).toBeUndefined();
    // … and BOTH are in `row_key`. That asymmetry is the bug and the fix.
    expect(Object.keys(w.row_key).sort()).toEqual(['tenant_id', 'type']);
  });

  it('★★★ restoring is itself an AUDITED write', () => {
    // Not by doing anything special: the restore's UPDATE / INSERT fires the same
    // trigger as any other change. Otherwise the restore would be the one write
    // with no history, which is the joke writing itself.
    expect(CODE).toMatch(/UPDATE public\.%I SET/);
    expect(CODE).toMatch(/INSERT INTO public\.%I/);
    expect(SQL).toMatch(/RESTORING IS ITSELF AN AUDITED WRITE/i);
  });

  it('★ and the restorable set matches the SQL\'s own list', () => {
    for (const t of RESTORABLE_TABLES) {
      expect(CODE).toContain(`'${t}'`);
    }
    // The two lists are the same length, so neither can gain a member alone.
    // ★ Group 1 is the function BODY. `[\s\S]*?$function$` alone stops at the
    //   OPENING delimiter, which matched nothing useful and is why this assertion
    //   failed the first time it ran.
    const body =
      CODE.match(/bp_restorable_tables[\s\S]*?\$function\$([\s\S]*?)\$function\$/)?.[1] ??
      '';
    expect(body).not.toBe('');
    for (const t of RESTORABLE_TABLES) expect(body).toContain(t);
    // ★★ AND NOTHING ELSE IS IN IT. A table added to the SQL's list without being
    //    added to `RESTORABLE_TABLES` would leave the client hiding a button the
    //    server would have honoured.
    expect((body.match(/'[a-z_]+'/g) ?? []).length).toBe(RESTORABLE_TABLES.length);
    expect(isRestorableTable('draw_schedule_quarter_layout')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 — THE CENSUS: every hand-arranged table has a history trigger', () => {
  // ★★★ THE BRIEF'S LAST TEST: *"a new table added to the hand-arranged set
  //     without a history trigger fails. Prove it by adding one."* Proven at the
  //     bottom of this block against a synthetic set, so the proof does not
  //     require leaving a broken file behind.

  it('★★★ all eight, each firing on INSERT, UPDATE **and** DELETE', () => {
    for (const t of HAND_ARRANGED_TABLES) {
      expect(triggerEventsFor(CODE, t), `${t} has no audit trigger`).toBe('IUD');
    }
  });

  it('★★★ …and `projects`, whose UPDATE-only audit was the same hole', () => {
    // fix-520's trigger was `AFTER UPDATE ON public.projects`. Two words, and the
    // whole lesson: a deleted project left no trace and neither did a created one.
    expect(triggerEventsFor(CODE, 'projects')).toBe('IUD');
    expect(CODE).toContain('DROP TRIGGER IF EXISTS projects_audit_row ON public.projects');
  });

  it('★★★ the census FAILS when a table is added to the set and not wired up', () => {
    const pretendSet = [...HAND_ARRANGED_TABLES, 'project_consultants'];
    const missing = pretendSet.filter((t) => triggerEventsFor(CODE, t) !== 'IUD');
    expect(missing).toEqual(['project_consultants']);
  });

  it('★ the four tables that must NOT be audited are not', () => {
    // ⛔ §4: recording the recorder is noise.
    for (const t of ['error_reports', 'audit_log', 'client_build_seen']) {
      expect(triggerEventsFor(CODE, t)).toBeNull();
    }
    expect(CODE).not.toMatch(/CREATE TRIGGER \w*backup/i);
  });

  it('★★★ ONE mechanism — no fourth audit table, and the bespoke two untouched', () => {
    // §1: *"DO NOT WRITE A FOURTH, and DO NOT rewrite the two bespoke ones."*
    expect(CODE).not.toMatch(/CREATE TABLE\s+\w*audit/i);
    expect(CODE).not.toContain('bp_audit_permit_task');
    expect(CODE).not.toContain('bp_audit_draw_schedule');
    expect(CODE).not.toContain('bp_audit_task_assignee');
    expect(CODE).not.toMatch(/DROP\s+FUNCTION/i);
    // ★ Every trigger this file creates points at the ONE function.
    const fns = Array.from(CODE.matchAll(/EXECUTE FUNCTION public\.(\w+)/g)).map((m) => m[1]);
    expect(new Set(fns)).toEqual(new Set(['bp_audit_row']));
    expect(fns.length).toBe(AUDITED_TABLES.length);
  });

  it('★★ the row identity is DERIVED from the catalogue, not declared per table', () => {
    // The brief's ★: *"so attaching the trigger to a ninth table later needs no
    // thought."* A trigger argument listing key columns would be a second place
    // to keep the schema.
    expect(CODE).toContain('bp_audit_pk_cols');
    expect(CODE).toContain('indisprimary');
    expect(CODE).toContain('public.bp_audit_pk_cols(TG_RELID)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 §4 — what the migration must not do', () => {
  it('★★★ it is NOT applied, and it says so where somebody will read it first', () => {
    expect(SQL).toContain('NOT APPLIED');
    expect(SQL.indexOf('NOT APPLIED')).toBeLessThan(1200);
  });

  it('★★★ no RLS policy is created, altered or dropped — and audit_log\'s read does not widen', () => {
    // §4: *"`audit_log`'s own read policy must not widen — a person who cannot
    // see a project must not read its history either. State how you checked."*
    // HOW I CHECKED: measured on prod 2026-09-29, every one of the nine audited
    // tables has a SELECT policy of exactly `tenant_id = ANY (auth_tenant_ids())`
    // — the SAME predicate `audit_log` already uses. So recording their history
    // cannot expose a row somebody could not already read, and this file changes
    // no policy at all.
    expect(CODE).not.toMatch(/CREATE\s+POLICY/i);
    expect(CODE).not.toMatch(/ALTER\s+POLICY/i);
    expect(CODE).not.toMatch(/DROP\s+POLICY/i);
    expect(CODE).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('★★★ the audit can never fail a person\'s save', () => {
    // §4: *"say in the PR what happens if the insert fails."* It is swallowed —
    // the edit stands and the history entry is lost. AFTER-ness alone does NOT
    // give you that: an exception in an AFTER trigger still aborts the statement,
    // so the handler is explicit.
    expect(CODE).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(CODE).toMatch(/AFTER INSERT OR UPDATE OR DELETE/);
    expect(CODE).not.toMatch(/BEFORE INSERT OR UPDATE OR DELETE/);
  });

  it('★★★ no retention or pruning job', () => {
    // ⛔ §4: 19 MB. Revisit at a gigabyte.
    expect(CODE).not.toMatch(/DELETE\s+FROM\s+public\.audit_log/i);
    expect(CODE).not.toMatch(/pg_cron|cron\.schedule/i);
    expect(CODE).not.toMatch(/TRUNCATE/i);
  });

  it('★★ and the new actions cannot crowd the activity feed', () => {
    // `bp_scraper_activity_feed_action` is an ALLOWLIST — `action LIKE 'scrape\_%'
    // OR action = 'manual_admin_correction'` — applied BEFORE fix-370's row
    // budget. fix-370's lesson was that a LIMIT made a "14-day" feed cover 19
    // hours, so a new high-volume action name starting `scrape_` would be a
    // regression of it. None of these do.
    const actions = Array.from(CODE.matchAll(/EXECUTE FUNCTION public\.bp_audit_row\('?(\w*)'?\)/g))
      .map((m) => m[1]);
    for (const noun of actions) {
      expect(noun.startsWith('scrape')).toBe(false);
    }
    expect(CODE).not.toContain('manual_admin_correction');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-590 §2.1 — what the panel shows', () => {
  const row: AuditLogRow = {
    id: 3,
    created_at: '2026-09-28T10:00:00Z',
    user_id: null,
    action: 'permit_cycles_updated',
    table_name: 'permit_cycles',
    row_id: '55',
    row_key: { id: 55 },
    changes: {
      submitted: { before: null, after: '2026-09-20' },
      updated_at: { before: 'a', after: 'b' },
    },
  };

  it('★ names the columns that moved, and never `updated_at`', () => {
    expect(changedColumns(row)).toEqual(['submitted']);
  });

  it('★★ null and empty-string stay different, because they are different events', () => {
    // "Nobody typed one" and "somebody cleared it" are not the same thing, and a
    // panel that printed both as blank would lose the distinction it exists to
    // preserve — this ticket's own theme, one level down.
    expect(formatHistoryValue(null)).toBe('—');
    expect(formatHistoryValue('')).toBe('(blank)');
    expect(formatHistoryValue(false)).toBe('no');
    expect(formatHistoryValue(0)).toBe('0');
    expect(formatHistoryValue({ a: 1 })).toBe('{"a":1}');
  });

  it('★ a long jsonb value truncates for the row and keeps the whole thing in the title', () => {
    const long = 'x'.repeat(400);
    expect(truncateHistoryValue(long).length).toBeLessThanOrEqual(80);
    const e = toHistoryEntry({ ...row, changes: { u: { before: long, after: null } } });
    expect(e.fields[0].rawBefore).toBe(long);
  });

  it('★ an unrecognised action is kept, not dropped', () => {
    // A history that silently omitted rows would be the original defect in
    // miniature. `audit_log` holds 44 distinct actions, most of them the
    // scraper's.
    expect(historyOp('scrape_change_applied')).toBeNull();
    const e = toHistoryEntry({ ...row, action: 'scrape_change_applied' });
    expect(e.op).toBeNull();
    expect(e.fields.length).toBe(1);
  });

  it('★★★ an EMPTY history says why it is empty — the other half of §0', () => {
    // *"I could not tell him whether it had been deleted or never saved."* Those
    // were one observation; they are two now. When the answer is "never saved"
    // there is nothing to put back and the screen has to say so — a restore that
    // invented a layout would be worse than the gap it filled.
    expect(emptyHistoryLine(null)).toMatch(/No changes recorded/);
    expect(emptyHistoryLine('16 Sep 2026')).toMatch(/cannot be told apart from never having been saved/);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** The events a `CREATE TRIGGER` on `table` fires on, as sorted letters, or
 *  `null` when this file creates no trigger for it. */
function triggerEventsFor(sql: string, table: string): string | null {
  const re = new RegExp(
    `CREATE TRIGGER\\s+\\w+\\s+AFTER\\s+([A-Z\\s]*?OR[A-Z\\s]*?|\\w+)\\s+ON\\s+public\\.${table}\\b`,
    'i',
  );
  const m = sql.match(re);
  if (!m) return null;
  const ev = m[1].toUpperCase();
  return ['INSERT', 'UPDATE', 'DELETE']
    .filter((e) => ev.includes(e))
    .map((e) => e[0])
    .join('');
}

function asAuditRow(w: AuditWrite): AuditLogRow {
  return {
    id: 1,
    created_at: '2026-09-28T10:00:00Z',
    user_id: w.user_id,
    action: w.action,
    table_name: w.table_name,
    row_id: w.row_id,
    row_key: w.row_key,
    changes: w.changes,
  };
}
