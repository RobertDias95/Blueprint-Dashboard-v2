import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isFinishedPermit,
  fillIfBlank,
  isDateFieldHistory,
  finishedPermitWord,
  ddHistoryNote,
  finishedPermitsNote,
} from '../lib/finishedPermits';

// ===========================================================================
// ★★★ fix-624 (P-320) — a finished permit's blank dates get filled, never
//     overwritten · its design-date fields show history
// ===========================================================================
//
// ⚖️ Bobby, 2026-10-05: **"Fill blanks, never overwrite."**
//
// fix-621 locked all four fields on a finished permit, blank ones included, so
// 193 of 592 finished permits (38 created in the last 30 days) could never get a
// DD window. fix-624 narrows the rule: a recorded value is history and never
// changes; a blank one is not a record of anything and gets filled.
//
// ★ NO LIVE DATABASE IN CI, so the server half is pinned the fix-153 way — the
//   migration's own patch table is parsed and asserted, never restated.

const SRC = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8');
const SQL = readFileSync(
  resolve(SRC, '../migrations/fix_624_fill_blanks_never_overwrite.sql'),
  'utf8',
);

/** ★★ CRLF normalised FIRST — `\r` is a JS regex line terminator, so a `//`
 *  stripper against CRLF text silently strips nothing (fix-608). */
function code(src: string): string {
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The body of the closure that patches the PERMITS cache in one of the two
 *  hooks. Scoped deliberately: both hooks also patch other things (the lane, the
 *  OCC token) that must not be judged by the fill rule. */
function permitsPatchClosure(file: string, c: string): string {
  const name = file.includes('useUpdateDrawSchedule')
    ? 'const cascadePermits ='
    : 'const patchProjectPermits =';
  const start = c.indexOf(name);
  expect(start, `${file} has its permits patch closure`).toBeGreaterThan(-1);
  const end = c.indexOf('setQueryData', start);
  expect(end, `${file} closure terminates`).toBeGreaterThan(start);
  return c.slice(start, end);
}

function patches(): { fn: string; seq: number; anchor: string; repl: string }[] {
  const start = SQL.indexOf('    FROM (VALUES');
  const end = SQL.indexOf('    ) AS t(fn, seq, anchor, repl)');
  expect(start, 'the VALUES table is found').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = SQL.slice(start, end);
  const re =
    /\(\s*'(bp_[a-z_0-9]+)'\s*,\s*(\d+)\s*,\s*E'((?:[^']|'')*)'\s*,\s*E'((?:[^']|'')*)'\s*\)/g;
  const out: { fn: string; seq: number; anchor: string; repl: string }[] = [];
  const unesc = (x: string) => x.replace(/''/g, "'").replace(/\\n/g, '\n');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push({ fn: m[1], seq: Number(m[2]), anchor: unesc(m[3]), repl: unesc(m[4]) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// §A — the server rule
// ---------------------------------------------------------------------------
describe('fix-624 §A — fill blanks, never overwrite', () => {
  it('★★★ every path fix-621 guarded is re-guarded, plus the manual flag', () => {
    const byFn = new Map<string, number>();
    for (const p of patches()) byFn.set(p.fn, (byFn.get(p.fn) ?? 0) + 1);
    expect(Object.fromEntries([...byFn].sort())).toEqual({
      bp_update_draw_schedule_with_dd_sync: 3,
      bp_resolve_da_overlap: 6,
      // ★ ONE, not two: the CLEAR path keeps fix-621's `AND NOT finished`,
      //   because writing NULL over a recorded window is an overwrite.
      bp_set_bp_dd_dates: 1,
      bp_move_draw_schedule_da: 3,
      bp_shift_da_blocks_up: 3,
      bp_place_new_project_on_da: 2,
      // the BP pre-loop block, the BP loop, and fix-585's non-BP loop
      bp_recompute_target_submits: 3,
      // ★★★ the one fix-621 argued needed no guard — see the suite below
      bp_trg_set_target_submit_manual_flag: 1,
    });
  });

  it('★★★ every permit write replaces the skip with a per-field fill', () => {
    const writes = patches().filter((p) => /UPDATE\s+(public\.)?permits/.test(p.anchor));
    expect(writes).toHaveLength(18);
    for (const p of writes) {
      // the anchor is fix-621's blanket skip …
      expect(p.anchor, `${p.fn}/${p.seq}`).toContain(
        'AND NOT public.bp_permit_is_finished(approval_date, actual_issue)',
      );
      // … and the replacement decides PER FIELD
      expect(p.repl, `${p.fn}/${p.seq} fills per field`).toContain(
        'public.bp_fill_if_blank(approval_date, actual_issue,',
      );
      // ★★ AND KEEPS A SCOPE TEST. Dropping it would write a recorded window
      //    with its own value, bumping updated_at on every sibling — fix-341.
      expect(p.repl, `${p.fn}/${p.seq} still scopes the row`).toMatch(
        /AND \(NOT public\.bp_permit_is_finished\(approval_date, actual_issue\)\s*\n?\s*OR (dd_start IS NULL OR dd_end IS NULL|target_submit IS NULL)\)/,
      );
    }
  });

  it('★★ a dd pair names BOTH fields, a target write names only its own', () => {
    // ★ The filter is `UPDATE … permits`, not `UPDATE`: the manual-flag
    //   trigger's anchor contains `TG_OP = 'UPDATE'` and is not a permit write.
    for (const p of patches().filter((x) =>
      /UPDATE\s+(public\.)?permits/.test(x.anchor),
    )) {
      const fills = p.repl.match(/bp_fill_if_blank\(/g)?.length ?? 0;
      const isPair = /dd_start IS NULL OR dd_end IS NULL/.test(p.repl);
      expect(fills, `${p.fn}/${p.seq}`).toBe(isPair ? 2 : 1);
    }
  });

  it('★★★ the CLEAR path is deliberately NOT patched', () => {
    // `dd_start = NULL` on a finished permit is either a no-op or the plainest
    // possible overwrite. fix-621's guard is right there and stays.
    const touched = patches().filter((p) => p.fn === 'bp_set_bp_dd_dates');
    expect(touched).toHaveLength(1);
    expect(touched[0].anchor).toContain('v_start_week_monday');
    expect(touched[0].anchor).not.toContain('dd_start = NULL');
    // and the file says why, where a reader will look
    expect(SQL).toMatch(/CLEAR PATH IS DELIBERATELY NOT TOUCHED/);
  });

  it('★★★ the engine now skips only a finished permit that ALREADY has a target', () => {
    const eng = patches().filter((p) => p.fn === 'bp_recompute_target_submits');
    expect(eng).toHaveLength(3);
    // the two CONTINUE guards gain "AND target_submit IS NOT NULL"
    const loops = eng.filter((p) => /THEN CONTINUE; END IF;/.test(p.anchor));
    expect(loops).toHaveLength(2);
    for (const p of loops) {
      expect(p.repl).toMatch(/AND v_permit\.target_submit IS NOT NULL THEN CONTINUE/);
    }
    // the pre-loop BP block gains "OR v_bp_target IS NULL"
    const pre = eng.find((p) => /IF v_bp_id IS NOT NULL/.test(p.anchor));
    expect(pre, 'the BP pre-loop block is patched').toBeTruthy();
    expect(pre!.repl).toMatch(/OR v_bp_target IS NULL\) THEN/);
    // ★ fix-585's rule is NARROWED, not deleted — its sentence survives.
    const f585 = eng.find((p) => p.anchor.includes('fix-585: done is done'));
    expect(f585!.repl).toContain('fix-585: done is done');
    expect(f585!.repl).toMatch(/NARROWS it rather than reversing it/);
  });

  it('★★★ the manual-flag trigger stops changing the flag on a finished permit', () => {
    const t = patches().find(
      (p) => p.fn === 'bp_trg_set_target_submit_manual_flag',
    );
    expect(t, 'the trigger is patched').toBeTruthy();
    // the new branch returns before the dd branch can clear the flag
    expect(t!.repl).toMatch(
      /IF TG_OP = 'UPDATE'\s*\n\s*AND public\.bp_permit_is_finished\(NEW\.approval_date, NEW\.actual_issue\) THEN\s*\n\s*NEW\.target_submit_is_manual := OLD\.target_submit_is_manual;\s*\n\s*RETURN NEW;/,
    );
    // ★ and the original dd branch is still there, for OPEN permits
    expect(t!.repl).toContain('v_dd_changed :=');
    // ★★ the file records WHY fix-621's opposite decision was right then
    expect(SQL).toMatch(/fix-621 deliberately left `bp_trg_set_target_submit_manual_flag` alone/);
    expect(SQL).toMatch(/36 of the 193/);
  });

  it('★★ the fill helper is IMMUTABLE, per-field, and not anon-callable', () => {
    const c = code(SQL);
    expect(c).toMatch(
      /CREATE OR REPLACE FUNCTION public\.bp_fill_if_blank\(\s*p_approval_date date,\s*p_actual_issue\s+date,\s*p_current\s+date,\s*p_new\s+date\s*\)/,
    );
    expect(c).toContain('IMMUTABLE');
    expect(c).toMatch(/THEN COALESCE\(p_current, p_new\)/);
    expect(c).toContain(
      'REVOKE ALL ON FUNCTION public.bp_fill_if_blank(date, date, date, date) FROM public, anon;',
    );
    expect(c).toContain(
      'GRANT EXECUTE ON FUNCTION public.bp_fill_if_blank(date, date, date, date) TO authenticated;',
    );
    expect(c).not.toMatch(/REVOKE ALL ON FUNCTION[^;]*FROM anon;/);
  });

  it('★★★ the migration changes NO DATA and does not backfill the 193', () => {
    const c = code(SQL);
    const doStart = c.indexOf('DO $patch$');
    const doEnd = c.indexOf('$patch$;');
    expect(doStart).toBeGreaterThan(-1);
    const topLevel = c.slice(0, doStart) + c.slice(doEnd + '$patch$;'.length);
    expect(
      topLevel.match(
        /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE|DROP TABLE|ALTER TABLE)\s+(public\.)?(permits|projects|draw_schedule|permit_cycles)\b/g,
      ),
    ).toBeNull();
    expect(SQL).toMatch(/does NOT fill the 193 blanks/);
  });

  it('★★ a drifted anchor FAILS the apply instead of no-opping', () => {
    const c = code(SQL);
    expect(c).toMatch(/v_hits\s*<>\s*1/);
    expect(c).toMatch(/RAISE EXCEPTION/);
    expect(c).toContain('pg_get_functiondef');
    expect(c).toContain("replace(v_def, chr(13), '')");
  });
});

// ---------------------------------------------------------------------------
// §A — the TS twin
// ---------------------------------------------------------------------------
describe('fix-624 — fillIfBlank, the twin of bp_fill_if_blank', () => {
  const open = { approval_date: null, actual_issue: null };
  const approved = { approval_date: '2026-01-01', actual_issue: null };
  const issued = { approval_date: null, actual_issue: '2026-02-02' };

  it('★★★ a finished permit FILLS a blank and KEEPS a value', () => {
    expect(fillIfBlank(approved, null, '2027-06-07')).toBe('2027-06-07');
    expect(fillIfBlank(issued, null, '2027-06-07')).toBe('2027-06-07');
    expect(fillIfBlank(approved, '2026-03-03', '2027-06-07')).toBe('2026-03-03');
    expect(fillIfBlank(issued, '2026-03-03', '2027-06-07')).toBe('2026-03-03');
  });

  it('an OPEN permit always takes the new value — unchanged behaviour', () => {
    expect(fillIfBlank(open, '2026-03-03', '2027-06-07')).toBe('2027-06-07');
    expect(fillIfBlank(open, null, '2027-06-07')).toBe('2027-06-07');
    // ★ including a clear: an open permit's dates really do go to null
    expect(fillIfBlank(open, '2026-03-03', null)).toBeNull();
  });

  it('★★★ a CLEAR cannot blank a finished permit\'s recorded date', () => {
    // The server's CLEAR path excludes finished rows outright; the twin reaches
    // the same answer from the rule itself, so the cache agrees either way.
    expect(fillIfBlank(approved, '2026-03-03', null)).toBe('2026-03-03');
    // …and a finished permit that was already blank stays blank.
    expect(fillIfBlank(approved, null, null)).toBeNull();
  });

  it('★ per field: a blank end beside a filled start fills only the end', () => {
    const bp = { ...approved, dd_start: '2026-01-05', dd_end: null };
    expect(fillIfBlank(bp, bp.dd_start, '2027-06-07')).toBe('2026-01-05');
    expect(fillIfBlank(bp, bp.dd_end, '2027-07-09')).toBe('2027-07-09');
  });

  it('isFinishedPermit is untouched by this ticket', () => {
    expect(isFinishedPermit(approved)).toBe(true);
    expect(isFinishedPermit(issued)).toBe(true);
    expect(isFinishedPermit(open)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §B — the fields show history
// ---------------------------------------------------------------------------
describe('fix-624 §B — a recorded date is history, a blank one is live', () => {
  const approved = { approval_date: '2026-01-01', actual_issue: null };
  const issued = { approval_date: '2026-01-01', actual_issue: '2026-02-02' };
  const open = { approval_date: null, actual_issue: null };

  it('★★★ filled + finished = history; blank + finished = still editable', () => {
    expect(isDateFieldHistory(approved, '2026-01-05')).toBe(true);
    expect(isDateFieldHistory(approved, null)).toBe(false);
    expect(isDateFieldHistory(approved, '')).toBe(false);
    // an OPEN permit is never history, however filled
    expect(isDateFieldHistory(open, '2026-01-05')).toBe(false);
  });

  it('★★ "Issued" wins over "Approved" when both dates are present', () => {
    expect(finishedPermitWord(approved)).toBe('Approved');
    expect(finishedPermitWord(issued)).toBe('Issued');
    expect(finishedPermitWord(open)).toBeNull();
  });

  it('★★★ Bobby\'s sentence, word for word', () => {
    expect(ddHistoryNote(approved, '2026-01-05', '2026-02-06')).toBe(
      "Approved — these are the Building Permit's design dates. " +
        'Move the block on the Draw Schedule to change the lane.',
    );
    expect(ddHistoryNote(issued, '2026-01-05', '2026-02-06')).toMatch(/^Issued — /);
  });

  it('★★ silent while both are blank — those boxes still work', () => {
    expect(ddHistoryNote(approved, null, null)).toBeNull();
    expect(ddHistoryNote(open, '2026-01-05', '2026-02-06')).toBeNull();
    // ★ one filled is enough to explain the one that is read-only
    expect(ddHistoryNote(approved, '2026-01-05', null)).not.toBeNull();
  });

  it('★★★ the DD window disables the FILLED field only, and shows the line', () => {
    const c = code(read('components/ProjectDetail/ProjectDataEditors.tsx'));
    expect(c).toMatch(/const ddStartIsHistory = isDateFieldHistory\(bp, bp\.dd_start\)/);
    expect(c).toMatch(/const ddEndIsHistory = isDateFieldHistory\(bp, bp\.dd_end\)/);
    expect(c).toMatch(/disabled=\{occMissing \|\| !canEdit \|\| ddStartIsHistory\}/);
    expect(c).toMatch(/disabled=\{occMissing \|\| !canEdit \|\| ddEndIsHistory\}/);
    expect(c).toContain('data-testid="pd-dd-history-note"');
  });

  it('★★ fix-621\'s count line SURVIVES, for the case it was written for', () => {
    // The BP is open (boxes live) but a sibling is finished and keeps its dates.
    // Two different facts, so two sentences — and never both at once.
    const c = code(read('components/ProjectDetail/ProjectDataEditors.tsx'));
    expect(c).toContain('data-testid="pd-dd-finished-note"');
    expect(c).toMatch(/ddHistory \? \(/);
    expect(finishedPermitsNote([{ approval_date: '2026-01-01', actual_issue: null }])).toBe(
      '1 approved permit keeps its dates.',
    );
  });
});

// ---------------------------------------------------------------------------
// §A — the optimistic cache follows the fill, not the skip
// ---------------------------------------------------------------------------
describe('fix-624 §A — the optimistic patches fill blanks too', () => {
  it('★★★ both hooks moved from "skip finished" to fillIfBlank', () => {
    for (const f of ['hooks/useUpdateDrawSchedule.ts', 'hooks/useSetBpDdDates.ts']) {
      const c = code(read(f));
      expect(c, `${f} imports the twin`).toMatch(
        /import \{ fillIfBlank \} from '\.\.\/lib\/finishedPermits'/,
      );
      // ★ fix-621's blanket skip is GONE — leaving it would hide a real write.
      expect(c, `${f} no longer skips`).not.toMatch(/if \(isFinishedPermit\(p\)\) return p;/);
      // ★★★ EVERY dd ASSIGNMENT IN THE PERMITS PATCH, NOT JUST ONE. The
      //     red-proof caught this: `useUpdateDrawSchedule` has TWO branches
      //     (Building Permit and the rest) and a bare `toMatch` was satisfied by
      //     whichever one still filled — so reverting the BP branch alone stayed
      //     green.
      //
      // ★★ AND THE SCAN IS SCOPED TO THAT CLOSURE, which the first fix of this
      //    test got wrong: the same hook also patches the `draw_schedule` LANE
      //    optimistically, and the lane MUST take the new weeks unconditionally
      //    — the block really does move. A file-wide scan flagged that correct
      //    line as a miss.
      const patchFn = permitsPatchClosure(f, c);
      const ddStarts = patchFn.match(/dd_start: [^,\n]*/g) ?? [];
      const ddEnds = patchFn.match(/dd_end: [^,\n]*/g) ?? [];
      expect(ddStarts.length, `${f} assigns dd_start in the permits patch`)
        .toBeGreaterThan(0);
      expect(ddEnds.length, `${f} assigns dd_end in the permits patch`)
        .toBeGreaterThan(0);
      for (const a of [...ddStarts, ...ddEnds]) {
        // ★ `[^,\n]*` stops at the first comma, so the captured text is
        //   `dd_start: fillIfBlank(p` — match the call, not its argument list.
        expect(a, `${f}: every dd assignment goes through the twin`).toContain(
          'fillIfBlank(',
        );
      }
    }
  });

  it('★★ the LANE still takes the new weeks unconditionally', () => {
    // The block moves. Only the permit ROWS are rationed, which is the whole
    // shape of fix-621 and fix-624 — if the lane ever started filling-only, a
    // finished project's block could not be dragged at all.
    const c = code(read('hooks/useUpdateDrawSchedule.ts'));
    const lane = c.slice(c.indexOf('setQueryData<DrawScheduleRow[]>'));
    expect(lane.slice(0, 600)).toMatch(/dd_start: newDdStart,/);
    expect(lane.slice(0, 600)).not.toMatch(/dd_start: fillIfBlank/);
  });

  it('★★ fix-121\'s target_submit blanking is now fill-aware', () => {
    // It nulls the cached target so a placeholder shows until the engine's value
    // lands. On a finished permit with a RECORDED target that would flash "—"
    // over a date the server will not touch.
    const c = code(read('hooks/useSetBpDdDates.ts'));
    expect(c).toMatch(/target_submit: fillIfBlank\(p, p\.target_submit, null\)/);
  });
});
