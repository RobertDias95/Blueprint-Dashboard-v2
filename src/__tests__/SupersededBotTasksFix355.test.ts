import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_355_superseded_bot_tasks.sql?raw';
import FIX337 from '../../migrations/fix_337_stale_work.sql?raw';
import FIX354 from '../../migrations/fix_354_auto_closed_notification.sql?raw';
// ★ fix-364 renamed one of the five rules — `superseded_intake_accepted` read
// like the rule that was DELIBERATELY EXCLUDED from this ticket, so it became
// `superseded_by_intake_acceptance`. The rule itself is unchanged; the name
// now lives in fix-364's migration, which re-emits the writer.
import FIX364 from '../../migrations/fix_364_task_vocabulary.sql?raw';
import {
  buildNewItems,
  keyForAutoClosed,
  unseenCount,
  unseenItems,
  type AutoClosureItemInput,
} from '../lib/boardReads';

// ===========================================================================
// fix-355 — 56 bot tasks are asking for work the permit already did
// ===========================================================================
//
// Register #102, Bobby: *"I think that goes to the bot tasks as well — like, did
// this get accepted and it's out for corrections? If there's conflicting stuff
// like that, we want to mark it off and create a notification for it."*
//
// ★★★ THE SHAPE OF WHAT THIS FIXES, in one row: a task created 2026-06-16 asking
// somebody to verify that 7133442-CN's intake was submitted — on a permit whose
// intake the city had ACCEPTED on 2026-06-15, the day before. Open for 64 days,
// asking a question the city had already answered.
//
// ★★ MEASURED ON PROD 2026-08-20, and re-measured after the rules were
// city-anchored (the numbers did not move):
//
//     superseded_status_matched   15      tasks closed   56
//     superseded_next_cycle       14      permits        46
//     superseded_intake_accepted  13      notifications  46
//     superseded_number_present    7      recipients      3  (Miles 42, Bobby 2,
//     superseded_resubmitted       7                          Briana 2)
//
// ★ intake_accepted is NOT a rule — see the describe at the bottom.

const SQL = MIGRATION.split(/\r?\n/)
  .map((l) => (l.trim().startsWith('--') ? '' : l))
  .join('\n');

/** Just the writer's body — the CASE that decides, without the prose. */
const WRITER = SQL.slice(
  SQL.indexOf('CREATE OR REPLACE FUNCTION public.bp_supersede_stale_bot_tasks'),
);

/** ★ fix-364: the CURRENT source for the rule names and the CHECK. This
 *  migration re-emitted the writer to rename one rule, so it — not fix-355's
 *  file — is what the database now runs. fix-355's own text stays imported
 *  above and is still asserted for everything the rename did not touch, which
 *  is what proves the re-emission carried the rest across intact. */
const CURRENT = FIX364.split(/\r?\n/)
  .map((l) => (l.trim().startsWith('--') ? '' : l))
  .join('\n');
const CURRENT_WRITER = CURRENT.slice(
  CURRENT.indexOf('CREATE OR REPLACE FUNCTION public.bp_supersede_stale_bot_tasks'),
);

/** The guard's BODY only. Its COMMENT ON FUNCTION is a SQL statement, not a
 *  `--` comment, so it survives stripping — and it says the word `start_date`
 *  in order to explain why the body does not use it. A test that could not tell
 *  the two apart would forbid the explanation. */
const GUARD = (() => {
  const from = SQL.indexOf('CREATE OR REPLACE FUNCTION public.bp_task_touched_by_person');
  const body = SQL.slice(from);
  return body.slice(0, body.indexOf('$function$;'));
})();

const BASE = {
  flips: [],
  tasks: [],
  acks: [],
  permits: [],
  projects: [],
  viewerName: 'Miles',
};

function closure(over: Partial<AutoClosureItemInput> = {}): AutoClosureItemInput {
  return {
    id: 'c1',
    permit_id: 900,
    project_id: 'p1',
    address: '3921 43rd Ave S',
    permit_label: '7133442-CN · Building Permit',
    reason: 'superseded',
    detail: 'Closed because the city accepted the intake on 2026-06-15.',
    recipient: 'Miles',
    task_count: 1,
    closed_at: '2026-08-20T10:00:00Z',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The notification
// ---------------------------------------------------------------------------

describe('fix-355: the 16-June task closes and says why', () => {
  it('★★★ the headline names the JUDGEMENT, not issuance', () => {
    const item = buildNewItems({ ...BASE, autoClosures: [closure()] })[0]!;
    expect(item.source).toBe('auto_closed');
    expect(item.title).toBe('1 task closed — the permit moved past them');
    // ★ Not fix-354's words: that permit did not issue, and saying it did would
    // be a lie the reader would catch on the permit page.
    expect(item.title).not.toContain('the permit issued');
  });

  it('★★★ and the subtitle carries evidence the reader can CHECK', () => {
    // §2: fix-354's items report a FACT; these report a JUDGEMENT, and a
    // judgement the reader cannot check is one they cannot overturn.
    const item = buildNewItems({ ...BASE, autoClosures: [closure()] })[0]!;
    expect(item.subtitle).toContain('the city accepted the intake on 2026-06-15');
    expect(item.subtitle).toMatch(/reopen/i);
    // ★ Never the column name at the reader.
    expect(item.subtitle).not.toMatch(/superseded_|auto_closed_reason/);
  });

  it('★★ fix-354\'s own wording is untouched — a fact still reads as a fact', () => {
    const item = buildNewItems({
      ...BASE,
      autoClosures: [closure({ reason: 'permit_issued', detail: null, task_count: 6 })],
    })[0]!;
    expect(item.title).toBe('6 tasks closed — the permit issued');
    expect(item.subtitle).toMatch(/no longer applies/);
  });

  it('★ plural agrees, both ways', () => {
    const one = buildNewItems({ ...BASE, autoClosures: [closure({ task_count: 1 })] })[0]!;
    const four = buildNewItems({ ...BASE, autoClosures: [closure({ task_count: 4 })] })[0]!;
    expect(one.title).toContain('1 task closed');
    expect(four.title).toContain('4 tasks closed');
  });
});

describe('fix-355: one notification per permit, not per task', () => {
  it('★★ four tasks on one permit are ONE item — fix-354\'s rule, unchanged', () => {
    // Real shape: BLDG-2026-02118 at 7527 137th Ave NE, four tasks, two rules.
    const items = buildNewItems({
      ...BASE,
      autoClosures: [
        closure({
          id: 'real',
          task_count: 4,
          permit_label: 'BLDG-2026-02118 · Building Permit',
          address: '7527 137th Ave NE',
          detail:
            'Closed because the city recorded a resubmission on 2026-07-29; ' +
            'the permit has moved to a later review cycle.',
        }),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toContain('4 tasks');
    // ★★ And both rules are named in the one sentence, so grouping did not cost
    // the reader the reason.
    expect(items[0]!.subtitle).toContain('resubmission');
    expect(items[0]!.subtitle).toContain('later review cycle');
  });

  it('★★ the grouping happens in the DATABASE, not by folding items here', () => {
    // One ledger row per (permit, recipient) — the client never merges two rows
    // into one line, because a merge would need a second opinion about which
    // rows belong together.
    expect(SQL).toMatch(/GROUP BY tenant_id, permit_id, recipient\b/);
    expect(SQL).toMatch(/sum\(n\)::integer AS task_count/);
  });

  it('★ …and one clause per RULE, so two rounds do not repeat themselves', () => {
    expect(SQL).toMatch(/max\(clause\) AS clause/);
    expect(SQL).toMatch(/GROUP BY tenant_id, permit_id, recipient, rule/);
  });

  it('★ read state stays per person — fix-354\'s contract, unchanged', () => {
    const rows = [
      closure({ id: 'a', recipient: 'Miles' }),
      closure({ id: 'b', recipient: 'Bobby' }),
    ];
    const miles = buildNewItems({ ...BASE, autoClosures: rows });
    const bobby = buildNewItems({ ...BASE, viewerName: 'Bobby', autoClosures: rows });
    expect(unseenCount(miles, new Set([keyForAutoClosed('a')]))).toBe(0);
    expect(unseenItems(bobby, new Set([keyForAutoClosed('a')]))).toHaveLength(1);
  });

  it('★ no second notification mechanism was added', () => {
    // The brief forbids one, and fix-354 built the ledger precisely so a second
    // writer could exist without one.
    expect(SQL).toMatch(/INSERT INTO public\.permit_task_auto_closures/);
    const otherTables = [
      ...SQL.matchAll(/INSERT INTO public\.(\w+)/gi),
    ].map((m) => m[1]);
    expect([...new Set(otherTables)]).toEqual(['permit_task_auto_closures']);
  });
});

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

describe('fix-355: five rules, each named and separately countable', () => {
  const RULES = [
    'superseded_resubmitted',
    'superseded_next_cycle',
    // ★ fix-364: renamed, same rule.
    'superseded_by_intake_acceptance',
    'superseded_status_matched',
    'superseded_number_present',
  ];

  it('★★ each has its own auto_closed_reason — not one "superseded" bucket', () => {
    // When one of these is wrong (and one will be), Bobby must be able to name
    // it and it must be disableable without touching the other four.
    // ★ fix-364 re-emitted the writer AND the CHECK in order to rename one
    // rule, so that migration — not this one — is what the database runs now.
    // The four unchanged rules are asserted against BOTH files, which is what
    // proves the re-emission carried them across intact rather than quietly
    // dropping one.
    for (const r of RULES) {
      expect(CURRENT, r).toContain(`'${r}'`);
      expect(CURRENT_WRITER, `${r} must be assignable by the writer`).toContain(
        `'${r}'`,
      );
    }
    for (const r of RULES.filter((x) => x !== 'superseded_by_intake_acceptance')) {
      expect(SQL, `${r} was fix-355's and is unchanged`).toContain(`'${r}'`);
      expect(WRITER, `${r} in fix-355's writer`).toContain(`'${r}'`);
    }
    // The CHECK is total over them, so a typo cannot write a sixth silently.
    for (const r of RULES) expect(CURRENT).toMatch(new RegExp(`CHECK[\\s\\S]*?'${r}'`));
  });

  it('★★★ intake_accepted is NOT a rule — asserted, so re-adding it is deliberate', () => {
    // fix-354 §5 measured it at 0 of 17. A rule that never fires is a rule
    // nobody can audit and nobody can trust.
    expect(RULES).not.toContain('superseded_intake_accepted_event');
    // ★★ fix-364: and the NAME no longer reads like that rule either, which is
    // the whole of why it was renamed — two different things with
    // near-identical names sat side by side in one feed.
    expect(RULES).not.toContain('superseded_intake_accepted');
    // The writer must never branch on the intake_accepted EVENT…
    expect(CURRENT_WRITER).not.toMatch(/auto_event = 'intake_accepted'/);
    // …though it does read the intake_accepted COLUMN, which is the evidence
    // for a different rule entirely. Both facts asserted so the distinction
    // cannot be lost.
    expect(CURRENT_WRITER).toMatch(/auto_event = 'intake_submitted'/);
    expect(WRITER).toMatch(/c\.intake_accepted IS NOT NULL/);
  });

  it('★ results_ready is untouched — fix-337 decided it exists BECAUSE of issuance', () => {
    expect(WRITER).not.toMatch(/'results_ready'/);
  });

  it('★★★ every rule rests on evidence the CITY produced', () => {
    // The field-ownership policy: permit_cycles.submitted / .resubmitted /
    // .corr_issued and permits.approval_date / .actual_issue are
    // portal-canonical; intake_accepted is portal fill-only-when-NULL.
    expect(WRITER).toMatch(/c\.resubmitted IS NOT NULL/);
    expect(WRITER).toMatch(/n\.submitted IS NOT NULL\s*OR n\.corr_issued IS NOT NULL/);
    expect(WRITER).toMatch(/c\.approval_date IS NOT NULL/);
    expect(WRITER).toMatch(/z\.submitted IS NOT NULL/);
  });

  it('★★★ and the two CLIENT-WRITABLE columns are never trusted alone', () => {
    // permits.num and permits.status both reach the database through
    // useUpdatePermit's Partial<Permit> patch, so a person can type either.
    //
    // number_present: the number AND a portal-canonical `submitted` somewhere.
    expect(WRITER).toMatch(
      /auto_event = 'number_entry'[\s\S]{0,200}NULLIF\(btrim\(c\.num\), ''\) IS NOT NULL[\s\S]{0,200}z\.submitted IS NOT NULL/,
    );
    // status_matched: the PORTAL'S OWN WORDS out of the task text, AND the
    // scraper has looked at this permit since the task was raised.
    expect(WRITER).toMatch(/portal shows \(\.\*\?\) — dashboard shows/);
    expect(WRITER).toMatch(/c\.permit_updated_at > c\.created_at/);
  });

  it('★ a task on no cycle cannot be closed by a cycle rule', () => {
    // The join is LEFT, so intake_accepted / resubmitted are NULL when the
    // task's cycle_idx points at nothing — and every cycle rule tests IS NOT
    // NULL, so a missing cycle can only ever mean "no".
    expect(WRITER).toMatch(/LEFT JOIN public\.permit_cycles c/);
  });
});

// ---------------------------------------------------------------------------
// The human-touched guard
// ---------------------------------------------------------------------------

describe('fix-355: never close a task a person has worked on', () => {
  it('★★★ In Progress spares it', () => {
    expect(GUARD).toMatch(/t\.completion_status = 'In Progress'/);
  });

  it('★★★ notes spare it', () => {
    expect(GUARD).toMatch(/NULLIF\(btrim\(t\.notes\), ''\) IS NOT NULL/);
  });

  it('★★★ a co-assignee a PERSON added spares it', () => {
    expect(GUARD).toMatch(/COALESCE\(array_length\(t\.co_assignees, 1\), 0\) > 0/);
    // ★ source='manual' — fix-346's own dm_of_da rows are the machine's, and
    // sparing a task because the machine co-assigned it would be the machine
    // deferring to itself.
    expect(GUARD).toMatch(/a\.source = 'manual'/);
  });

  it('★★★ a human EDIT in the audit log spares it', () => {
    // fix-272 captures task edits with an actor. actor_uid IS NOT NULL is what
    // separates a person's edit from a trigger's.
    expect(GUARD).toMatch(/permit_task_audit u[\s\S]{0,120}u\.op = 'UPDATE'/);
    expect(GUARD).toMatch(/u\.actor_uid IS NOT NULL/);
  });

  it('★★★ and start_date is NOT a signal — the correction that mattered most', () => {
    // ★ ALL 56 candidates carry a start_date, because fix-292 and then fix-349
    // set it AT CREATION from the city's own date. On a human's task it means
    // somebody started it; on a bot task it means the row was born. Using it
    // would have spared all 56 and shipped a writer that closes nothing.
    expect(GUARD).not.toMatch(/start_date/);
  });

  it('★★ the writer consults the guard, and it is a hard AND', () => {
    expect(WRITER).toMatch(/AND NOT public\.bp_task_touched_by_person\(t\.id\)/);
  });
});

// ---------------------------------------------------------------------------
// Both halves
// ---------------------------------------------------------------------------

describe('fix-355: the forward half AND the existing 56', () => {
  it('★★★ a one-time run exists — a trigger alone would only fix the future', () => {
    // A trigger fires on WRITE, and a task nobody touches is never written, so
    // the 64-day-old one would still be sitting there.
    expect(SQL).toMatch(/FOR v_permit IN[\s\S]{0,400}SELECT DISTINCT t\.permit_id/);
    expect(SQL).toMatch(/v_total := v_total \+ public\.bp_supersede_stale_bot_tasks/);
  });

  it('★★ the one-time run calls the SAME function the triggers call', () => {
    // So the backfill and every future close cannot diverge.
    const calls = [...SQL.matchAll(/public\.bp_supersede_stale_bot_tasks\(/g)];
    // once in each trigger fn, once in the one-time loop, plus the definition.
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(SQL).not.toMatch(/UPDATE public\.permit_tasks[\s\S]{0,200}auto_closed_reason = 'superseded_[\s\S]{0,200}FROM public\.permit_tasks/);
  });

  it('★★ the triggers watch the EVIDENCE, not the tasks', () => {
    // The task is stale precisely because nobody writes to it.
    expect(SQL).toMatch(
      /CREATE TRIGGER permit_cycles_supersede_tasks\s+AFTER INSERT OR UPDATE OF submitted, intake_accepted, corr_issued, resubmitted/,
    );
    expect(SQL).toMatch(
      /CREATE TRIGGER permits_supersede_tasks\s+AFTER UPDATE OF status, num ON public\.permits/,
    );
  });

  it('★★ close and tell in ONE statement — fix-354\'s rule', () => {
    expect(WRITER).toMatch(/WITH candidate AS \(/);
    expect(WRITER).toMatch(/closed AS \(\s*UPDATE public\.permit_tasks/);
    expect(WRITER).toMatch(/logged AS \(\s*INSERT INTO public\.permit_task_auto_closures/);
  });

  it('★ and it reuses fix-354\'s routing ladder rather than re-deriving it', () => {
    expect(WRITER).toMatch(/public\.bp_auto_close_recipient\(cl\.assigned_to, cl\.permit_id\)/);
    expect(FIX354).toMatch(/CREATE OR REPLACE FUNCTION public\.bp_auto_close_recipient/);
    // A recipient-less group is dropped, never written half-formed.
    expect(WRITER).toMatch(/WHERE recipient IS NOT NULL/);
  });
});

// ---------------------------------------------------------------------------
// Prior contracts
// ---------------------------------------------------------------------------

describe('fix-355: prior contracts survive', () => {
  it('★★ fix-337\'s permit_issued closure is untouched', () => {
    // This ticket adds a writer beside it; it does not widen or rewrite it.
    expect(SQL).not.toMatch(/bp_clear_tasks_for_issued_permit/);
    expect(FIX337).toMatch(/AND t\.auto_event IS DISTINCT FROM 'results_ready'/);
    expect(SQL).toMatch(/'permit_issued'/); // still legal in the widened CHECK
  });

  it('★ fix-354\'s ledger keeps its shape — one new column, no renames', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS detail text/);
    expect(SQL).not.toMatch(/DROP COLUMN|RENAME COLUMN/);
    expect(SQL).not.toMatch(/DROP TABLE/);
  });

  it('★ nothing here closes a task on a permit that merely LOOKS finished', () => {
    // No status-string heuristics: every rule reads a date or the portal's own
    // recorded words, never "the status says approved".
    expect(WRITER).not.toMatch(/status ILIKE|status LIKE|status IN \(/);
  });
});
