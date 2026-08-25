import { describe, it, expect } from 'vitest';
import RULES from '../../migrations/fix_405_stale_bot_task_rules.sql?raw';
import CANCEL from '../../migrations/fix_405_cancel_trigger_and_mint_gate.sql?raw';
import FIX395 from '../../migrations/fix_395_city_target_chase_task.sql?raw';
import { AUTO_CLOSED_REASONS } from '../lib/database.types';
import { provenanceLine } from '../lib/taskProvenance';
import badgeSrc from '../components/shared/AutoClosedBadge.tsx?raw';

// ===========================================================================
// fix-405 — only what is valid, current and applicable
// ===========================================================================
//
// Bobby, 2026-08-26: *"There is that much volume of tasks being created and
// some of those are stale, and dont apply — i.e. first round corrections, but
// now in the 2nd or 3rd round etc. we only want what is valid and current and
// applicable. and to remove the noise."*
//
// ---------------------------------------------------------------------------
// ★★★ THE MEASUREMENT, BECAUSE IT CHANGED THE TICKET
// ---------------------------------------------------------------------------
//
// Measured on prod 2026-08-26. The brief said 730 OPEN bot tasks. There are 730
// bot tasks EVER; 543 of them are already closed (74%), leaving 187 open. The
// brief's per-kind figures (222/189/99/69/52/52/36/11) are the total-ever
// column exactly. The machinery was not failing three quarters of its job.
//
//     bucket (a)  a rule covers it and did not fire ........  0
//     bucket (b)  no rule covers it ......................   26
//     bucket (c)  genuinely valid, undone work ...........  161
//
// ★★★ BUCKET (a) IS EMPTY, AND THAT WAS TESTED, NOT ASSUMED. The existing
// closer was run over every permit holding an open bot task inside a
// transaction ending in RAISE EXCEPTION: it would have closed ZERO. So there is
// no fix-395-class dead rule among the ones already shipped — every stale task
// is a SHAPE NO RULE COVERS, which is what §2 adds.
//
// ★★ BUCKET (c) IS DOMINATED BY 105 `results_ready` TASKS, and they are all on
// permits that are issued (96) or approved (9) — i.e. the task's own premise is
// true and somebody has not done the work. 93 are Miles's, average age 13 days,
// oldest 61. That is a workload finding, not a bug, and closing them would
// delete real work.
//
// ★★★ THE SQL HALF WAS EXERCISED AGAINST PRODUCTION inside a rolled-back
// transaction; nothing persisted. CI has no live DB (this repo's fix-153
// pattern), so the mirrors below ARE the tested contract.

/** ★ Comment-stripped. Both migrations discuss every rule name at length in
 *  prose, so a raw `toContain('superseded_next_cycle')` would pass on the
 *  header alone — the trap fix-387, fix-390 and fix-395 each hit. */
function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((l) => (l.trim().startsWith('--') ? '' : l))
    .join('\n');
}

const SQL = stripComments(RULES);
const CANCEL_SQL = stripComments(CANCEL);

/** The body of one function, so an assertion cannot match another's text. */
function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$;', start);
  expect(end, `${name} body not terminated`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const CLOSER = fnBody(SQL, 'bp_supersede_stale_bot_tasks');
const MINTER_SWEEP = fnBody(CANCEL_SQL, 'bp_generate_number_entry_tasks');
const HOLD_TRIGGER = fnBody(CANCEL_SQL, 'bp_trg_supersede_on_project_hold');

/** The `CASE` that decides a rule, without the CTEs around it. Assertions about
 *  ORDER must be made here — the `explained` CTE lists the same names again in
 *  a different order, and comparing indexes across both would be meaningless. */
const DECIDER = CLOSER.slice(
  CLOSER.indexOf('ruled AS ('),
  CLOSER.indexOf('explained AS ('),
);

/** Every rule the decider can return, in the order it tests them. */
const RULE_ORDER = [...DECIDER.matchAll(/THEN '(superseded_\w+)'/g)].map(
  (m) => m[1]!,
);

// ---------------------------------------------------------------------------
// §1 · THE CLASSIFICATION — the three new shapes, and nothing else
// ---------------------------------------------------------------------------

describe('fix-405 §1: the shapes no rule covered', () => {
  it('★★★ BOBBY\'S OWN CASE — a task about an EARLIER cycle now closes', () => {
    // The rule existed and was wired to ONE event. `resubmitted` had it;
    // `intake_accepted` and `corr_issued` ask the same question about the same
    // cycle and were never connected to it, so a task about round 1 sat open
    // forever once the permit reached round 2.
    expect(DECIDER).toMatch(
      /WHEN c\.auto_event IN \('intake_accepted', 'corr_issued'\)\s*\n\s*AND c\.later_city_cycle > 0\s*\n\s*THEN 'superseded_next_cycle'/,
    );
    // ★ The pre-existing arm is untouched and still separate.
    expect(DECIDER).toMatch(
      /WHEN c\.auto_event = 'resubmitted' AND c\.later_city_cycle > 0\s*\n\s*THEN 'superseded_next_cycle'/,
    );
  });

  it('★★★ "a round-2 task on a round-2 permit STAYS" is what `later_city_cycle` means', () => {
    // The counter is defined as cycles STRICTLY LATER than the task's own, so a
    // task on the current cycle counts zero and no arm can fire. If it were
    // `>=` — or counted all cycles — every task would close the moment it was
    // minted, which is the failure mode this pins.
    expect(CLOSER).toMatch(/n\.cycle_index > t\.cycle_idx/);
    expect(CLOSER).not.toMatch(/n\.cycle_index >= t\.cycle_idx/);
    // ★★ And a later cycle only counts once the CITY has touched it. An empty
    // row created ahead of time is not "the permit moved on" — fix-389's
    // ruling, which is why these three columns and not the row's existence.
    expect(CLOSER).toMatch(
      /n\.submitted IS NOT NULL\s*\n\s*OR n\.corr_issued IS NOT NULL\s*\n\s*OR n\.intake_accepted IS NOT NULL/,
    );
  });

  it('★★ HONEST ABOUT THE DATA: the corrections half has no backlog today', () => {
    // Bobby described first-round CORRECTIONS. Measured on prod, all 13 open
    // `corr_issued` tasks are on their permit's CURRENT cycle with no later
    // one — the shape is presently 0 for corrections and 23 for
    // `intake_accepted`. Both are in the rule; only one has a pile. This is
    // recorded so a later reader does not conclude the rule is broken when it
    // closes nothing on the kind Bobby named.
    const prose = RULES.replace(/^\s*--\s?/gm, '').replace(/\s+/g, ' ');
    expect(prose).toMatch(/presently zero for corrections and 23 for intake_accepted/i);
  });

  it('★★ a withdrawn permit expects nothing of anybody (fix-388)', () => {
    expect(DECIDER).toMatch(
      /WHEN btrim\(COALESCE\(c\.status,''\)\) IN \('Withdrawn', 'Application Withdrawn'\)\s*\n\s*THEN 'superseded_permit_withdrawn'/,
    );
    // ★ Enumerated exact values, trimmed — never a substring test. fix-388's
    // rule: /withdraw/i would also catch a status meaning the opposite.
    expect(DECIDER).not.toMatch(/status.*ILIKE|~\*/);
  });

  it('★★ a cancelled project is off live work (fix-262), and CANCEL IS NOT HOLD', () => {
    expect(DECIDER).toMatch(/WHEN c\.project_cancelled\s*\n\s*THEN 'superseded_project_cancelled'/);
    // ★★★ The predicate reads `kind = 'cancelled'` AND an OPEN hold. A plain
    // hold is a PAUSE — its work is still applicable, it is coming back — and
    // fix-390/391 already make it quiet. Closing a paused permit's tasks would
    // be a different and wrong claim.
    expect(CLOSER).toMatch(
      /FROM public\.project_holds h\s*\n\s*WHERE h\.project_id = p\.project_id\s*\n\s*AND h\.hold_end IS NULL AND h\.kind = 'cancelled'/,
    );
  });

  it('★★★ ORDERING: "the permit is dead" outranks every per-event reason', () => {
    // A chase task on a withdrawn permit closing as "the city responded
    // (Withdrawn)" is technically true and useless. The ledger line is what a
    // person reads on the board, so the stronger statement has to win.
    expect(RULE_ORDER[0]).toBe('superseded_project_cancelled');
    expect(RULE_ORDER[1]).toBe('superseded_permit_withdrawn');
    for (const later of RULE_ORDER.slice(2)) {
      expect(RULE_ORDER.indexOf(later)).toBeGreaterThan(1);
    }
  });

  it('★★ every pre-existing rule survives, in its original relative order', () => {
    // A re-emitted function is a whole-body rewrite: a dropped arm would not
    // error, it would silently stop closing a shape that used to close.
    const existing = [
      'superseded_resubmitted',
      'superseded_next_cycle',
      'superseded_by_intake_acceptance',
      'superseded_status_matched',
      'superseded_number_present',
      'superseded_city_responded',
      'superseded_target_changed',
    ];
    for (const r of existing) expect(RULE_ORDER, r).toContain(r);
    // fix-395's own ordering claim, restated where it could be broken.
    expect(RULE_ORDER.indexOf('superseded_city_responded')).toBeLessThan(
      RULE_ORDER.indexOf('superseded_target_changed'),
    );
  });
});

// ---------------------------------------------------------------------------
// §2 · THE GUARDS EVERY RULE INHERITS
// ---------------------------------------------------------------------------

describe('fix-405 §2: a new rule cannot escape the old contracts', () => {
  it('★★★ NO RULE CLOSES A TASK A HUMAN TOUCHED — fix-355, and it is one gate', () => {
    // The guard is in the `candidate` CTE, so it applies to every arm of the
    // CASE at once. A per-rule guard is how the next rule forgets it.
    expect(CLOSER).toMatch(/AND NOT public\.bp_task_touched_by_person\(t\.id\)/);
    const candidate = CLOSER.slice(
      CLOSER.indexOf('candidate AS ('),
      CLOSER.indexOf('ruled AS ('),
    );
    expect(candidate).toContain('bp_task_touched_by_person');
    // ★★ fix-355's ruling: start_date is NOT a human-touch signal on a bot
    // task, so the closer must not consult it.
    expect(CLOSER).not.toMatch(/t\.start_date/);
  });

  it('★★ ...and an already-finished task is never re-closed', () => {
    expect(CLOSER).toMatch(/AND t\.completion_status <> 'Resolved'/);
    expect(CLOSER).toMatch(/AND COALESCE\(t\.done, false\) = false/);
    expect(CLOSER).toMatch(/AND t\.auto_event IS NOT NULL/); // bot tasks only
  });

  it('★★★ THE LEDGER IS WRITTEN, at its existing grain (fix-354/360)', () => {
    // One row per permit per recipient. A new reason must not open a second
    // notification path or a second grain — fix-360's watermark key depends on
    // this shape holding still.
    expect(CLOSER).toMatch(/INSERT INTO public\.permit_task_auto_closures/);
    expect(CLOSER).toMatch(/GROUP BY tenant_id, permit_id, recipient/);
    expect(CLOSER).toMatch(/public\.bp_auto_close_recipient\(cl\.assigned_to, cl\.permit_id\)/);
    // ★ No bespoke notification insert anywhere in either migration.
    expect(SQL).not.toMatch(/INSERT INTO public\.(notifications|board_item|whats_new)/i);
    expect(CANCEL_SQL).not.toMatch(/INSERT INTO public\.(notifications|board_item|whats_new)/i);
  });

  it('★★★ BOTH NEW REASONS GET THEIR OWN LEDGER CLAUSE — never a blank line', () => {
    // `explained` maps reason -> the sentence a person reads. A rule added to
    // the CASE and forgotten here yields NULL, and `'Closed because ' || NULL`
    // is NULL — the whole detail string vanishes for that permit.
    const explained = CLOSER.slice(CLOSER.indexOf('explained AS ('));
    expect(explained).toMatch(
      /WHEN 'superseded_permit_withdrawn' THEN\s*\n\s*'the permit was withdrawn \('/,
    );
    expect(explained).toMatch(
      /WHEN 'superseded_project_cancelled' THEN\s*\n\s*'the project was cancelled'/,
    );
    // ★★ EVERY rule the decider can return has a clause — asserted as a set,
    // so the next rule cannot be added to one half only.
    const explainedNames = new Set(
      [...explained.matchAll(/WHEN '(superseded_\w+)' THEN/g)].map((m) => m[1]!),
    );
    expect([...new Set(RULE_ORDER)].filter((r) => !explainedNames.has(r))).toEqual([]);
  });

  it('★★ the withdrawn clause names the ACTUAL status, and survives a blank one', () => {
    // Both stored spellings reach the same reason, so the clause has to say
    // which one it saw; and a permit with a blank status must not produce a
    // NULL detail through the concatenation.
    const explained = CLOSER.slice(CLOSER.indexOf('explained AS ('));
    expect(explained).toMatch(
      /'the permit was withdrawn \(' \|\| COALESCE\(NULLIF\(btrim\(r\.status\), ''\), '\?'\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// §3 · TRIGGER COVERAGE — the fix-395 gap class, asserted structurally
// ---------------------------------------------------------------------------

describe('fix-405 §3: every rule has a trigger that can invoke it', () => {
  // ★★★ THE GAP CLASS, IN ONE SENTENCE: a supersede rule whose driving column
  // no trigger watches is DEAD CODE. It is correct, it is live, and it never
  // runs. fix-395 shipped `superseded_target_changed` and discovered
  // `city_target` was not in the cycle trigger's UPDATE OF list. These
  // assertions exist so that cannot silently return.

  /** What each rule reads, and which trigger has to be watching it. */
  const COVERAGE = [
    {
      rule: 'superseded_project_cancelled',
      reads: 'project_holds.kind / hold_end',
      // ★★★ NEW IN THIS TICKET. Before it, NOTHING on project_holds touched
      // tasks at all — the closer is invoked from `permits` and
      // `permit_cycles` and nowhere else. The rule would have been dead code.
      trigger: /AFTER INSERT OR UPDATE OF kind, hold_end ON public\.project_holds/,
      sql: () => CANCEL_SQL,
    },
    {
      rule: 'superseded_permit_withdrawn',
      reads: 'permits.status',
      trigger: /AFTER UPDATE OF status, num, approval_date ON public\.permits/,
      sql: () => FIX395,
    },
    {
      rule: 'superseded_next_cycle',
      reads: 'permit_cycles.submitted / intake_accepted / corr_issued',
      trigger:
        /AFTER INSERT OR UPDATE OF submitted, intake_accepted, corr_issued, resubmitted, city_target/,
      sql: () => FIX395,
    },
  ] as const;

  it.each(COVERAGE)(
    '★★★ $rule reads $reads — and a trigger watches exactly that',
    ({ rule, trigger, sql }) => {
      expect(RULE_ORDER, `${rule} is a live rule`).toContain(rule);
      expect(stripComments(sql()), `no trigger covers ${rule}`).toMatch(trigger);
    },
  );

  it('★★★ the project_holds trigger fires ONLY on a cancel that is still open', () => {
    // A plain hold must not close anything (see §1), and a LIFTED cancel is
    // likewise not a reason to close — so both are refused by name before the
    // loop, rather than being left to the closer's own predicate.
    expect(HOLD_TRIGGER).toMatch(
      /IF COALESCE\(NEW\.kind, 'hold'\) <> 'cancelled' OR NEW\.hold_end IS NOT NULL THEN\s*\n\s*RETURN NULL;/,
    );
  });

  it('★★★ it goes THROUGH the closer — it never closes rows itself', () => {
    // Every close in this system passes one function, so the human guard, the
    // reason vocabulary and the ledger cannot diverge. A second writer is
    // exactly how those three drift apart.
    expect(HOLD_TRIGGER).toMatch(/PERFORM public\.bp_supersede_stale_bot_tasks\(r\.id\)/);
    expect(HOLD_TRIGGER).not.toMatch(/UPDATE public\.permit_tasks/);
    expect(HOLD_TRIGGER).not.toMatch(/INSERT INTO public\.permit_task_auto_closures/);
  });

  it('★★ a cancel covers every permit on the project, not just one', () => {
    expect(HOLD_TRIGGER).toMatch(
      /FOR r IN SELECT id FROM public\.permits WHERE project_id = NEW\.project_id LOOP/,
    );
  });
});

// ---------------------------------------------------------------------------
// §4 · THE MINT SIDE — do not create what the closer must then delete
// ---------------------------------------------------------------------------

describe('fix-405 §4: the sweep stops minting onto dead work', () => {
  it('★★★ the two cancelled-project tasks were minted AFTER the cancel', () => {
    // Measured on prod: both were created three days after the cancellation
    // row. Without this gate, half one would close them and the sweep would
    // make them again — churn, not a fix. This is fix-395's own contract ("the
    // auto-clear must never close a task the minter would immediately
    // re-create"), not a reduction in minting, which the brief excludes.
    expect(MINTER_SWEEP).toMatch(
      /AND NOT EXISTS \(SELECT 1 FROM public\.project_holds h\s*\n\s*WHERE h\.project_id = p\.project_id AND h\.hold_end IS NULL\)/,
    );
  });

  it('★★★ BOTH SCOPES — a held PERMIT counts too (fix-390)', () => {
    expect(MINTER_SWEEP).toMatch(
      /AND NOT EXISTS \(SELECT 1 FROM public\.permit_holds h\s*\n\s*WHERE h\.permit_id = p\.id AND h\.hold_end IS NULL\)/,
    );
  });

  it('★★ the gate is HOLD-OR-CANCEL, deliberately wider than the closer\'s', () => {
    // The closer only CLOSES on a cancel, because a hold is a pause and its
    // work returns. The minter refuses BOTH, because there is no value in
    // creating a task for a permit nobody may act on today — and unlike a
    // close, not-minting is reversed for free by the next sweep.
    const gate = MINTER_SWEEP.slice(MINTER_SWEEP.indexOf('FOR v_permit IN'));
    expect(gate).toMatch(/project_holds/);
    expect(gate).not.toMatch(/kind = 'cancelled'/);
  });

  it('★★ nothing else about the sweep changed', () => {
    // Re-emitted whole, so the parts that must not move are pinned: the tenant
    // scope guard, the once-a-day latch, and counting mints not attempts.
    expect(MINTER_SWEEP).toMatch(/tenant % not in caller scope/);
    expect(MINTER_SWEEP).toMatch(/sweep_name = 'number_entry' AND last_swept_on >= v_today/);
    expect(MINTER_SWEEP).toMatch(/IF v_made IS NOT NULL THEN v_count := v_count \+ 1; END IF;/);
    expect(MINTER_SWEEP).toMatch(/AND \(p\.num IS NULL OR btrim\(p\.num\) = ''\)/);
  });
});

// ---------------------------------------------------------------------------
// §5 · THE VOCABULARY CHAIN — a reason is only real if every reader knows it
// ---------------------------------------------------------------------------

describe('fix-405 §5: both new reasons reach every reader', () => {
  const NEW = ['superseded_permit_withdrawn', 'superseded_project_cancelled'] as const;

  it.each(NEW)('★★★ %s — CHECK, TS list, badge tooltip, provenance line', (reason) => {
    // Reader 0 — the DB CHECK. Without it the closer raises 23514 and the
    // whole close transaction fails.
    const check = SQL.slice(SQL.indexOf('ADD CONSTRAINT permit_tasks_auto_closed_reason_check'));
    expect(check.slice(0, check.indexOf('));'))).toContain(`'${reason}'`);

    // Reader 1 — the TS mirror (fix-364's rule: the set matches the CHECK).
    expect(AUTO_CLOSED_REASONS).toContain(reason);

    // Reader 2 — the badge tooltip.
    expect(badgeSrc).toContain(`${reason}:`);

    // Reader 3 — fix-363's provenance line. A MACHINE close, never a person:
    // the three-state rule means a blank actor here would send somebody to ask
    // a colleague who never touched the task.
    const line = provenanceLine({
      kind: 'completed',
      at: '2026-08-26T09:00:00Z',
      actor_uid: null,
      actor_name: null,
      detail: 'Resolved',
      auto_mark: reason,
    });
    expect(line.state).toBe('machine');
    expect(line.actor).toBeNull();
    expect(line.text).toMatch(/^Closed automatically/);
    expect(line.text).not.toMatch(/undefined|null/);
  });

  it('★★ the CHECK is the FULL list, not a delta', () => {
    // `ADD CONSTRAINT` replaces the whole predicate, so re-emitting it means
    // re-listing every value. A forgotten one does not error — it silently
    // makes every row holding it unwritable.
    const check = SQL.slice(
      SQL.indexOf('ADD CONSTRAINT permit_tasks_auto_closed_reason_check'),
    );
    const listed = new Set(
      [...check.slice(0, check.indexOf('));')).matchAll(/'(\w+)'/g)].map((m) => m[1]!),
    );
    expect([...AUTO_CLOSED_REASONS].filter((r) => !listed.has(r))).toEqual([]);
    expect([...listed].filter((r) => !AUTO_CLOSED_REASONS.includes(r as never))).toEqual([]);
    // ★ And it drops the old constraint first, or the ADD fails on a duplicate
    //   name and the migration is a no-op that looks like a success.
    expect(SQL).toMatch(/DROP CONSTRAINT IF EXISTS permit_tasks_auto_closed_reason_check/);
  });

  it('★★ every rule the closer can WRITE is a value the CHECK ALLOWS', () => {
    // The two lists are edited in different halves of the same file; this is
    // the assertion that ties them together.
    const check = SQL.slice(SQL.indexOf('ADD CONSTRAINT'));
    const listed = new Set(
      [...check.slice(0, check.indexOf('));')).matchAll(/'(\w+)'/g)].map((m) => m[1]!),
    );
    expect([...new Set(RULE_ORDER)].filter((r) => !listed.has(r))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6 · THE SWEEP IS A REPORT — no row is closed by shipping this
// ---------------------------------------------------------------------------

describe('fix-405 §6: mechanism ships, data does not move', () => {
  it('★★★ NEITHER MIGRATION CLOSES A SINGLE EXISTING TASK', () => {
    // ★★ THE DISTINCTION THAT MAKES THIS ASSERTABLE: both files are full of
    // UPDATE and INSERT statements, and every one is inside a `$function$`
    // body — code that runs LATER, when a trigger fires, not now. So the
    // bodies are stripped and the assertion is made on what is left, which is
    // the only SQL the migrations themselves execute.
    for (const [name, sql] of [['rules', SQL], ['cancel', CANCEL_SQL]] as const) {
      const outside = sql.replace(/AS \$function\$[\s\S]*?\$function\$;/g, ' [body] ');
      expect(outside, name).toMatch(/\[body\]/); // the stripper actually stripped
      expect(outside, name).not.toMatch(/\bINSERT INTO\b/i);
      expect(outside, name).not.toMatch(/\bUPDATE\s+public\./i);
      expect(outside, name).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(outside, name).not.toMatch(/\bTRUNCATE\b/i);
    }
  });

  it('★★★ the 26 would-close rows are a REPORT — Bobby approves the sweep', () => {
    // ★★ The would-close list was produced by running the NEW closer over every
    // permit holding an open bot task, inside a transaction ending in RAISE
    // EXCEPTION. 26 of 187, by reason:
    //
    //     superseded_next_cycle        23   (intake_accepted, later cycle)
    //     superseded_project_cancelled  2   (number_entry, cancelled project)
    //     superseded_permit_withdrawn   1   (intake_accepted, withdrawn)
    //
    // Board deltas: Miles −25, Briana −1. Nobody else moves. 161 tasks stay,
    // including all 105 results_ready.
    //
    // ★★★ Nothing in this repo can run that sweep. It is deliberately not a
    // function, not a script and not a migration — it is a transcript in the PR
    // body, and it stays that way until Bobby says otherwise.
    expect(SQL).not.toMatch(/bp_sweep_stale_bot_tasks|bp_close_all_stale/i);
    for (const sql of [SQL, CANCEL_SQL]) {
      // No file loops every permit, which is the only shape a bulk sweep takes.
      expect(sql).not.toMatch(/FOR\s+\w+\s+IN\s+SELECT\s+id\s+FROM\s+public\.permits\s*LOOP/);
    }
  });

  it('★★ the closer is still per-permit, and still returns what it closed', () => {
    // It takes ONE permit id. That is what keeps it a trigger-driven closer
    // rather than something that could be pointed at the whole table.
    expect(CLOSER).toMatch(
      /bp_supersede_stale_bot_tasks\(p_permit_id integer\)\s*\nRETURNS integer/,
    );
    expect(CLOSER).toMatch(/WHERE t\.permit_id = p_permit_id/);
  });

  it('★★ both functions keep SECURITY DEFINER with a pinned search_path', () => {
    for (const body of [CLOSER, MINTER_SWEEP, HOLD_TRIGGER]) {
      expect(body).toMatch(/SECURITY DEFINER/);
      expect(body).toMatch(/SET search_path TO 'public', 'pg_temp'/);
    }
  });
});
