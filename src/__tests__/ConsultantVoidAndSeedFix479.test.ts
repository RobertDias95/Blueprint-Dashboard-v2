import { describe, it, expect } from 'vitest';
import VOID_SQL from '../../migrations/fix_479_consultant_rounds_void.sql?raw';
import WRITE_THROUGH_SQL from '../../migrations/fix_479_consultant_firm_write_through.sql?raw';
import SEED_SQL from '../../migrations/fix_479_seed_from_external_team.sql?raw';
import {
  CONSULTANT_STATUS_DEFAULT,
  consultantHasNothingToClear,
} from '../lib/consultants';

// ===========================================================================
// ★★★ fix-479 §C / §D / §E — VOID, WRITE THROUGH, AND THE SEED THAT LANDED
// ===========================================================================
//
// ★★ WHY SQL IS PINNED FROM TS AT ALL, restated because it looks odd every
// time: there is no live database in CI (project_no_live_db_test_mirror). The
// migrations are the only artefact of these three rulings that CI can see, so
// the rulings are asserted against the text that carries them. A rewrite that
// drops one of these clauses fails here rather than on prod.
//
// ★★★ AND THE COMMENT-STRIPPING TRAP, SIXTH TIME (fix-411). A `.toContain` on
// a phrase that also appears in a header comment passes on a file whose CODE
// no longer does it. Every assertion below that is about BEHAVIOUR runs against
// `code()` — the file with every `--` line removed — not against the raw text.
// The assertions that are about the REASONING run against the raw text on
// purpose, and say so.

/** The file with all comment lines stripped: what the database would actually
 *  execute. */
function code(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// §C — the rounds are voided, not deleted
// ---------------------------------------------------------------------------
describe('fix-479 §C: "clear the rounds" voids them', () => {
  const voidCode = code(VOID_SQL);
  const firmCode = code(WRITE_THROUGH_SQL);

  it('★★★ the column exists and it is nullable — NULL means "live"', () => {
    // ★ fix-386's three-state rule read the other way round: there are only two
    //   states here, and the DEFAULT one is the absence of a stamp. A NOT NULL
    //   column with a sentinel would have made "not voided" a value somebody
    //   has to write.
    expect(voidCode).toContain('add column if not exists voided_at timestamptz null');
  });

  it('★★★ NEITHER firm writer deletes a round any more — the whole ruling', () => {
    // ★ Asserted on BOTH files: §C introduced the void and §D redefines the
    //   same function, so a delete could come back in the second one.
    expect(voidCode).not.toMatch(/delete\s+from\s+public\.project_consultant_rounds/i);
    expect(firmCode).not.toMatch(/delete\s+from\s+public\.project_consultant_rounds/i);
    // …and what replaced it.
    expect(voidCode).toContain('set voided_at = now()');
    expect(firmCode).toContain('set voided_at = now()');
  });

  it('★★★ every "latest round" reader filters voided rows — all four of them', () => {
    // ★★ THE FAILURE THIS PREVENTS: one unfiltered reader targets a voided row,
    //    so a status flip or a date edit lands on history the screen says does
    //    not exist — and hands back a voided round's OCC token.
    for (const fn of [
      'bp_set_consultant_status',
      'bp_set_consultant_date',
      'bp_set_consultant_phase',
    ]) {
      const body = voidCode.slice(voidCode.indexOf(`function public.${fn}(`));
      const upTo = body.slice(0, body.indexOf('$function$;'));
      expect(upTo, `${fn} picks its latest round without filtering voided`).toContain(
        'r.voided_at is null',
      );
    }
    // ★ The VIEW is the fourth: both its lateral and its round_count.
    const view = voidCode.slice(
      voidCode.indexOf('create or replace view public.project_consultant_current'),
      voidCode.indexOf('create or replace function public.bp_set_consultant_status'),
    );
    expect(view).toContain('x.voided_at is null');
    expect(view).toContain('r2.voided_at is null');
  });

  it('★★★ the view is STILL security_invoker — re-declared, not assumed', () => {
    // CREATE OR REPLACE VIEW is not documented to preserve reloptions, and a
    // view that fell back to definer would read every tenant's consultants.
    expect(voidCode).toContain(
      'create or replace view public.project_consultant_current\nwith (security_invoker = true) as',
    );
  });

  it('★★★ the round index after a void CONTINUES — it does not restart at 0', () => {
    // ★★★ THE LOAD-BEARING FACT: project_consultant_rounds_index_unique is
    //     UNIQUE (consultant_id, round_index) over EVERY row, voided included.
    //     Re-inserting at index 0 after voiding round 0 raises. So the clear
    //     branch takes max(round_index) + 1 over ALL rounds.
    for (const sql of [voidCode, firmCode]) {
      const clear = sql.slice(sql.indexOf('if p_clear_rounds then'));
      const body = clear.slice(0, clear.indexOf('end if;'));
      expect(body).toContain('select coalesce(max(r.round_index), -1) + 1 into v_next_ix');
      // ★ …and that arithmetic must NOT filter voided rows, or it hands back an
      //   index a voided row already owns.
      const nextIx = body.slice(body.indexOf('into v_next_ix'));
      expect(nextIx.slice(0, nextIx.indexOf(';'))).not.toContain('voided_at');
      expect(body).toContain('v_next_ix,');
      expect(body).not.toMatch(/round_index[^)]*\)\s*values\s*\([^)]*,\s*0,/);
    }
  });

  it("★★ the REOPEN branch's next index is deliberately unfiltered too", () => {
    const status = voidCode.slice(
      voidCode.indexOf('function public.bp_set_consultant_status('),
    );
    const reopen = status.slice(status.indexOf("if v_cur.status = 'Received'"));
    const upTo = reopen.slice(0, reopen.indexOf('return next; return;'));
    expect(upTo).toContain('coalesce(max(r.round_index), -1) + 1');
    const nextIx = upTo.slice(upTo.indexOf('into v_next_ix'));
    expect(nextIx.slice(0, nextIx.indexOf(';'))).not.toContain('voided_at');
  });

  it('★★ NO voided_by — the brief\'s rule applied, not a half-audit invented', () => {
    // Neither table has ever recorded an actor: created_at and updated_at and
    // nothing else. "Match the existing audit columns, don't invent a pattern."
    expect(voidCode).not.toContain('voided_by');
    // ★ …and the file SAYS so, because the next reader will wonder.
    expect(VOID_SQL).toContain('NO `voided_by`');
  });

  it('★ the ruling and the objection it accepts are both recorded', () => {
    // Raw text on purpose: this is about the reasoning surviving, not the SQL.
    expect(VOID_SQL).toContain('Bobby 2026-09-02');
    expect(VOID_SQL).toContain('RECOVERABILITY IS A SQL `update` FOR NOW');
  });
});

// ---------------------------------------------------------------------------
// §C — and the prompt does not ask about nothing
// ---------------------------------------------------------------------------
describe('fix-479 §C: the firm prompt only asks when there is something to lose', () => {
  const empty = {
    round_count: 1,
    status: CONSULTANT_STATUS_DEFAULT,
    est_send: null,
    sent: null,
    est_recd: null,
    recd: null,
  };

  it('★★★ a just-added consultant has nothing to clear', () => {
    expect(consultantHasNothingToClear(empty)).toBe(true);
  });

  it('★★★ …but a SEEDED est date is content, so the prompt comes back', () => {
    // `bp_add_project_consultant` is handed est_send / est_recd from
    // seedConsultantDates whenever the project has a DD end and a target
    // submit. That round says something, and somebody may have adjusted it.
    expect(consultantHasNothingToClear({ ...empty, est_send: '2026-09-10' })).toBe(false);
    expect(consultantHasNothingToClear({ ...empty, est_recd: '2026-09-20' })).toBe(false);
  });

  it('★★ a second round, a non-default status or a stamped date all ask', () => {
    expect(consultantHasNothingToClear({ ...empty, round_count: 2 })).toBe(false);
    expect(consultantHasNothingToClear({ ...empty, status: 'Pending' })).toBe(false);
    expect(consultantHasNothingToClear({ ...empty, sent: '2026-09-01' })).toBe(false);
    expect(consultantHasNothingToClear({ ...empty, recd: '2026-09-02' })).toBe(false);
  });

  it('★★ round_count is the count of LIVE rounds, so a cleared consultant qualifies', () => {
    // ★★★ THIS IS WHY THE TEST IS NOT `round_index === 0`. After a void the
    //     fresh round's index is whatever the sequence reached (3, 4, …) while
    //     round_count is back to 1 — the same empty state, a different number.
    expect(consultantHasNothingToClear(empty)).toBe(true);
    expect(consultantHasNothingToClear({ ...empty, round_count: 0 })).toBe(true);
  });

  it('★ a null status reads as the default rather than as content', () => {
    // The view LEFT JOINs the round, so `status` is nullable in the type even
    // though the invariant says there is always one.
    expect(consultantHasNothingToClear({ ...empty, status: null })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §D — the write-through
// ---------------------------------------------------------------------------
describe('fix-479 §D: a firm change writes through to projects.external_team', () => {
  const sql = code(WRITE_THROUGH_SQL);

  it('★★★ BOTH firm writers write the blob, in their own transaction', () => {
    for (const fn of ['bp_add_project_consultant', 'bp_set_consultant_firm']) {
      const body = sql.slice(sql.indexOf(`function public.${fn}(`));
      const upTo = body.slice(0, body.indexOf('$function$;'));
      expect(upTo, `${fn} does not write through`).toContain(
        'update public.projects p',
      );
      expect(upTo).toContain('set external_team =');
      expect(upTo).toContain('jsonb_build_object(');
    }
  });

  it('★★★ the jsonb_typeof guard is there — 148 of 202 projects have NULL', () => {
    // `null || jsonb_build_object(...)` is NULL. Without the guard the
    // write-through silently does nothing on exactly the projects that have no
    // firms recorded yet, which is most of them.
    const guards = sql.match(/jsonb_typeof\(p\.external_team\) = 'object'/g) ?? [];
    expect(guards).toHaveLength(2);
  });

  it('★★★ a NO-OP re-pick writes nothing, so the OCC token does not move', () => {
    // ★★ fix-341's class: "modified by someone else" with nobody there is a
    //    write bumping a sibling's updated_at. Re-picking the firm a project
    //    already names must not disturb an open editor.
    const guards = sql.match(/\(p\.external_team ->> [^)]+\) is distinct from v_firm/g) ?? [];
    expect(guards).toHaveLength(2);
  });

  it('★★ the firm NAME comes from the same lookup that validates the firm', () => {
    // A second query could disagree with the one that did the validating.
    for (const fn of ['bp_add_project_consultant', 'bp_set_consultant_firm']) {
      const body = sql.slice(sql.indexOf(`function public.${fn}(`));
      const upTo = body.slice(0, body.indexOf('$function$;'));
      expect(upTo).toContain('select d.name into v_firm');
      expect(upTo).toContain('if v_firm is null then');
    }
  });

  it('★★ nothing DELETES a blob key — there is no remove-consultant control', () => {
    expect(sql).not.toContain('external_team - ');
    expect(sql).not.toContain('jsonb_delete');
  });

  it('★ the client is nowhere in it — server-side, so the two cannot drift', () => {
    // ★ NOT ACROSS A LINE BREAK (fix-474's own lesson, and the sixth time this
    //   trap has been recorded): a phrase that spans a wrapped comment line
    //   asserts the line endings, not the claim.
    expect(WRITE_THROUGH_SQL).toContain('not from the client');
  });
});

// ---------------------------------------------------------------------------
// §E — the seed
// ---------------------------------------------------------------------------
describe('fix-479 §E: the seed', () => {
  const sql = code(SEED_SQL);

  it('★★★ it RUNS now — the statements are no longer commented out', () => {
    // The exact inversion of fix-474 §5, which asserted the opposite.
    expect(sql).toContain('insert into public.project_consultants');
    expect(sql).toContain('insert into public.project_consultant_rounds');
    expect(sql).toContain('begin;');
    expect(sql).toContain('commit;');
  });

  it('★★★ the file name no longer says PENDING_APPROVAL', () => {
    // House practice: the state is in the filename. fix-450's shelf guard
    // enumerates by suffix, so a file that keeps the name keeps asking Bobby a
    // question he has already answered.
    expect(SEED_SQL).not.toContain('PENDING APPROVAL. NOT APPLIED');
    expect(SEED_SQL).toContain('APPROVED 2026-09-02');
  });

  it('★★★ the resolve gate is EXACT — an inner JOIN, no fuzzy matching', () => {
    // ★★ THE NUMBER THAT MAKES A SEED SAFE AT ALL is "every pair resolves".
    //    An outer join with a fallback would have created records pointing at
    //    firms nobody has ever heard of.
    expect(sql).toContain('join public.external_team_directory d');
    expect(sql).not.toMatch(/left\s+join\s+public\.external_team_directory/);
    expect(sql).toContain('lower(btrim(d.name)) = lower(pr.firm)');
    expect(sql).toContain('lower(btrim(d.discipline)) = lower(pr.discipline)');
    expect(sql).not.toContain('similarity(');
    expect(sql).not.toContain(' like ');
  });

  it('★★★ the ONE unmatched pair is named in full, not fuzzy-matched away', () => {
    // The gate fired: 163 of 164 resolved. Bobby ruled 2026-09-02 to add the
    // directory row rather than skip the project. It is one row, for one named
    // firm, and it is conditional on a project actually naming it.
    expect(sql).toContain('insert into public.external_team_directory');
    expect(sql).toContain("'Steep Slope Tree Consulting'");
    expect(sql).toContain("'Arborist'");
    // ★ It reads the tenant from the project rather than typing one.
    expect(sql).toContain('select distinct p.tenant_id');
    // ★ …and it cannot double on a re-run.
    expect(sql).toContain('not exists (');
    expect(SEED_SQL).toContain('5917 41st Ave SW');
  });

  it('★★★ a seeded record claims NO history — Scheduled, four null dates', () => {
    expect(sql).toContain("0, 'Design', 'Scheduled'");
    expect(sql).toContain('null, null, null, null');
    expect(SEED_SQL).toContain('all four dates NULL');
  });

  it('★★ it is idempotent — a re-run cannot double a round', () => {
    // Round 0 is created only for records the INSERT actually returned, so the
    // second run inserts nothing and therefore creates no rounds.
    expect(sql).toContain('on conflict (project_id, discipline) do nothing');
    expect(sql).toContain('returning id, tenant_id');
    expect(sql).toContain('from ins;');
  });

  it('★★★ the ORDER is recorded: §C shipped BEFORE the seed', () => {
    // The one sequencing rule in the brief, and the reason it matters: not one
    // seeded row has ever been reachable by a `delete`.
    expect(SEED_SQL).toContain('fix_479_consultant_rounds_void');
    expect(SEED_SQL).toContain('applied FIRST');
  });

  it('★★ the header carries the numbers measured on the day it ran', () => {
    // fix-450's precedent: never let a file's header be the only place its
    // number lives, and never measure a paraphrase.
    expect(SEED_SQL).toContain('MEASURED ON PROD 2026-09-02');
    expect(SEED_SQL).toContain('164');
    expect(SEED_SQL).toContain('163');
    expect(SEED_SQL).toContain('202');
  });
});
