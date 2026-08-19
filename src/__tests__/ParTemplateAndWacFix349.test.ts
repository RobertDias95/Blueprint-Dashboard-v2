import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_349_par_template_and_wac.sql?raw';
import FIX337 from '../../migrations/fix_337_stale_work.sql?raw';
import FIX181 from '../../migrations/fix_181_results_ready_autotask.sql?raw';
import {
  cityDateForEvent,
  lifecycleTaskDates,
} from '../lib/lifecycleTaskDates';
import { NO_ISSUANCE_PERMIT_TYPES } from '../lib/permitTypeTaxonomy';
import { SEEDING_RULES } from '../lib/permitSeedingDefaults';
import { defaultDaysForType } from '../lib/scheduleBenchmarks';
import { PERMIT_DESCRIPTION_SEED } from '../components/wizard/wizardState';

// ===========================================================================
// fix-349 — a task that duplicates a bot, and a permit modelled as a task
// ===========================================================================
//
// ★ MEASURED ON PROD 2026-08-19 BEFORE ANYTHING WAS WRITTEN:
//
//   Seattle PAR/Pre-Sub template  3 rows, all in bucket 'de'
//   'Permit approved — send out results — …'    25 bot tasks
//   'Permit issued — send out approved plans …' 107 bot tasks
//   ★ 003976-26PA carries BOTH the template row and the bot's task
//   bot tasks 560 · no start date 246 · start ≠ the city's date 155 · right 36
//   Seattle projects 130 · WAC permits 0 · permit_types 16 (now 17)
//
// ★★ CI HAS NO LIVE DATABASE, so the SQL is asserted two ways, which is the
// fix-153 pattern: `?raw` assertions on the migration text for the things that
// are structural (what it does and does NOT write), and a pure TS mirror
// (lib/lifecycleTaskDates) for the derivation. The function was additionally
// exercised against production inside a transaction ending in RAISE EXCEPTION —
// transcript in the PR body, nothing persisted.

/** The migration with `--` comment lines stripped, so an assertion about the
 *  EXECUTABLE SQL is never satisfied (or broken) by prose about it. This file's
 *  commentary quotes Bobby, permit numbers and column names freely. */
const SQL = MIGRATION.split(/\r?\n/)
  .map((l) => (l.trim().startsWith('--') ? '' : l))
  .join('\n');

// ---------------------------------------------------------------------------
// §1 — the template row that duplicated a bot
// ---------------------------------------------------------------------------

describe('fix-349 §1: the PAR template no longer produces "Review Results and send out"', () => {
  it('★★ deletes exactly that row, scoped to the Seattle PAR template', () => {
    expect(SQL).toMatch(/DELETE FROM public\.task_templates/);
    expect(SQL).toMatch(/permit_type\s*=\s*'PAR\/Pre-Sub'/);
    expect(SQL).toMatch(/jurisdiction\s*=\s*'Seattle'/);
    expect(SQL).toMatch(/text\s*=\s*'Review Results and send out'/);
  });

  it('★★ and deletes NOTHING else — one DELETE, on one table', () => {
    const deletes = SQL.match(/\bDELETE\s+FROM\b/gi) ?? [];
    expect(deletes).toHaveLength(1);
    // The sibling row is named in the file (in prose) but never deleted.
    expect(SQL).not.toMatch(/DELETE[\s\S]*Review WAC and send out/);
  });

  it('★★★ does NOT touch the six permit_tasks rows the template already produced', () => {
    // A template row is a recipe; deleting the recipe does not un-cook the
    // meal. Three of those six are still open and are somebody's live work.
    expect(SQL).not.toMatch(/\bFROM\s+public\.permit_tasks\b/i);
    expect(SQL).not.toMatch(/UPDATE\s+public\.permit_tasks/i);
  });

  it('★ is keyed on the semantic tuple, not a uuid, so a re-run is a no-op', () => {
    // A uuid would make this migration un-rerunnable against any other
    // environment and unreadable as a rule.
    expect(SQL).not.toMatch(/8f991d6f-e485-4def-a79e-0a70311541f3/);
  });
});

// ---------------------------------------------------------------------------
// §2 — the bot task's start date
// ---------------------------------------------------------------------------

const TODAY = '2026-08-19';

describe('fix-349 §2: a bot task starts when the CITY acted', () => {
  it('★★★ a permit approved in the PAST gets that date, not today', () => {
    // The brief's headline assertion, stated with an approval three weeks back.
    const { start_date } = lifecycleTaskDates(
      'results_ready',
      { basis: 'approved', approvalDate: '2026-07-29' },
      TODAY,
    );
    expect(start_date).toBe('2026-07-29');
    expect(start_date).not.toBe(TODAY);
  });

  it('★★ the issued variant reads actual_issue, not approval_date', () => {
    const { start_date } = lifecycleTaskDates(
      'results_ready',
      { basis: 'issued', approvalDate: '2026-04-30', actualIssue: '2026-08-06' },
      TODAY,
    );
    expect(start_date).toBe('2026-08-06');
  });

  it('★★ and the basis DEFAULTS to issued, exactly as the SQL COALESCE does', () => {
    const { start_date } = lifecycleTaskDates(
      'results_ready',
      { approvalDate: '2026-04-30', actualIssue: '2026-08-06' },
      TODAY,
    );
    expect(start_date).toBe('2026-08-06');
  });

  it('★★★ EVERY cycle event reads its own city date — not just the two measured', () => {
    // Fixing only results_ready would have left the identical bug in four other
    // places, including corr_issued — the event Bobby's own sentence is about.
    const cycle = {
      submitted: '2026-07-10',
      intake_accepted: '2026-07-15',
      corr_issued: '2026-07-20',
      resubmitted: '2026-07-25',
    };
    expect(cityDateForEvent('intake_submitted', { cycle })).toBe('2026-07-10');
    expect(cityDateForEvent('intake_accepted', { cycle })).toBe('2026-07-15');
    expect(cityDateForEvent('corr_issued', { cycle })).toBe('2026-07-20');
    expect(cityDateForEvent('resubmitted', { cycle })).toBe('2026-07-25');
  });

  it('★★ the two events with NO city date keep today — deliberately, not by omission', () => {
    // number_entry asks "was this submitted?" — a question ABOUT a missing
    // date. scrape_reconcile is a mismatch noticed now, by definition.
    expect(cityDateForEvent('number_entry', {})).toBeNull();
    expect(cityDateForEvent('scrape_reconcile', {})).toBeNull();
    expect(lifecycleTaskDates('number_entry', {}, TODAY).start_date).toBe(TODAY);
    expect(lifecycleTaskDates('scrape_reconcile', {}, TODAY).start_date).toBe(TODAY);
  });

  it('★★ a bot task ALWAYS carries a start date, whatever is missing', () => {
    // The brief asks for this in as many words. It is what stops the change
    // from turning "wrong date" into "no date".
    const events = [
      'intake_submitted',
      'intake_accepted',
      'corr_issued',
      'resubmitted',
      'number_entry',
      'scrape_reconcile',
      'results_ready',
    ] as const;
    for (const e of events) {
      // Nothing supplied at all — no cycle, no permit dates.
      const d = lifecycleTaskDates(e, {}, TODAY);
      expect(d.start_date).toBe(TODAY);
      expect(d.start_date).toBeTruthy();
    }
  });

  it('★★ a city date in the FUTURE never becomes a start date in the future', () => {
    // start_date means "the clock started". It cannot start tomorrow.
    const { start_date } = lifecycleTaskDates(
      'corr_issued',
      { cycle: { corr_issued: '2026-12-25' } },
      TODAY,
    );
    expect(start_date).toBe(TODAY);
  });

  it('★★★ target_date stays anchored to TODAY — a task is never born overdue', () => {
    // fix-292 set target = start + 1. With start now weeks in the past that
    // formula would create tasks already past due at birth, and since fix-348
    // blended tasks into the forecast they would land straight in Past due.
    const { start_date, target_date } = lifecycleTaskDates(
      'results_ready',
      { basis: 'approved', approvalDate: '2026-07-29' },
      TODAY,
    );
    expect(start_date).toBe('2026-07-29');
    expect(target_date).toBe('2026-08-20');
    expect(target_date > TODAY).toBe(true);
  });

  it('★★ NO EXISTING BOT TASK IS REWRITTEN — nothing backfills start_date', () => {
    // 401 of 560 have a missing or wrong start date. They are counted in the
    // PR and left exactly as they are: backfilling was not approved.
    expect(SQL).not.toMatch(/UPDATE\s+public\.permit_tasks/i);
    expect(SQL).not.toMatch(/SET\s+start_date/i);
  });

  it('★ fix-268\'s trigger rule is untouched — it is right for a human\'s task', () => {
    // bp_trg_task_start_date stamps only on a transition into In Progress /
    // Resolved, and never overwrites. This migration changes the VALUE
    // bp_create_lifecycle_task supplies, not that rule.
    expect(SQL).not.toMatch(/bp_trg_task_start_date/);
  });

  it('★★ the cycle lookup is guarded and never guesses a cycle', () => {
    // Measured: all four cycle-scoped events carry cycle_idx on 100% of rows,
    // and the three others on none. So the read is conditional, never a
    // "latest cycle" fallback — which is the class of bug fix-337 fixed.
    expect(SQL).toMatch(/p_cycle_idx IS NOT NULL/);
    expect(SQL).toMatch(/cycle_index = p_cycle_idx/);
    expect(SQL).not.toMatch(/ORDER BY cycle_index DESC/i);
  });

  it('★★ fix-337\'s issued-permit guard survives the re-emission verbatim', () => {
    // The function is CREATE OR REPLACE'd in full, so every earlier rule has to
    // be carried forward by hand. This is the one most easily lost.
    const guard = /IF v_permit\.actual_issue IS NOT NULL AND p_event <> 'results_ready' THEN\s+RETURN NULL;/;
    expect(FIX337).toMatch(guard);
    expect(SQL).toMatch(guard);
  });

  it('★ and so do the two ON CONFLICT dedupe keys', () => {
    expect(SQL).toMatch(/ON CONFLICT \(tenant_id, permit_id, auto_event, COALESCE\(cycle_idx, -1\)\)/);
    expect(SQL).toMatch(/ON CONFLICT \(tenant_id, permit_id\)/);
  });

  it('★ the seven-event whitelist is unchanged — no event was added or lost', () => {
    const events = [
      'intake_submitted',
      'intake_accepted',
      'corr_issued',
      'resubmitted',
      'number_entry',
      'scrape_reconcile',
      'results_ready',
    ];
    for (const e of events) expect(SQL).toContain(`'${e}'`);
    expect(SQL).toMatch(/RAISE EXCEPTION 'bp_create_lifecycle_task: unknown event/);
  });
});

// ---------------------------------------------------------------------------
// §3 — WAC is a permit, not a checkbox
// ---------------------------------------------------------------------------

describe('fix-349 §3: WAC becomes a permit type', () => {
  it('★★ inserts exactly one permit type, idempotently', () => {
    expect(SQL).toMatch(/INSERT INTO public\.permit_types \(name, is_builtin\)/);
    expect(SQL).toMatch(/VALUES \('WAC', false\)/);
    expect(SQL).toMatch(/ON CONFLICT \(name\) DO NOTHING/);
    const inserts = SQL.match(/INSERT INTO public\.permit_types/gi) ?? [];
    expect(inserts).toHaveLength(1);
  });

  it('★★★ NO EXISTING PROJECT GAINS A WAC PERMIT — no backfill, at all', () => {
    // 130 Seattle projects would each need one. Bobby's standing precedent, set
    // on PARs: "did not add to back fill. only adding now as we move forward."
    expect(SQL).not.toMatch(/INSERT INTO public\.permits\b/i);
    // Nor by any other route — no loop over projects, no create-permit RPC call.
    expect(SQL).not.toMatch(/bp_create_project_with_permits/);
    expect(SQL).not.toMatch(/\bFOR\s+\w+\s+IN\s+SELECT[\s\S]*FROM public\.projects/i);
  });

  it('★★ WAC is NOT added to NO_ISSUANCE_PERMIT_TYPES, and that is the point', () => {
    // That set is mirrored in the scraper repo (fix-41) and the two must stay
    // identical; changing it here alone would break the parity. Unknown types
    // already default to issuance-bearing, which is the right answer for a
    // certificate the city hands you — so WAC gets the 'Permit issued — send
    // out approved plans' task on actual_issue, like every other issuing type,
    // with no code change at all.
    expect([...NO_ISSUANCE_PERMIT_TYPES].sort()).toEqual([
      'ECA Waiver',
      'PAR/Pre-Sub',
      'SDOT Tree',
      'ULS',
    ]);
    expect(NO_ISSUANCE_PERMIT_TYPES.has('WAC')).toBe(false);
    // The SQL twin of that set (fix-181) is likewise untouched.
    expect(FIX181).toMatch(/NEW\.type IN \('SDOT Tree', 'PAR\/Pre-Sub', 'ECA Waiver', 'ULS'\)/);
    expect(SQL).not.toMatch(/NO_ISSUANCE|no_issuance/);
  });

  it('★★ WAC behaves like any other type: every per-type map falls back for it', () => {
    // Nothing in the app enumerates permit types — the dropdowns read
    // permit_types from the database — so "selectable" needs no code change.
    // What DOES need checking is that the type-keyed maps degrade gracefully
    // rather than throwing or returning undefined.
    expect(SEEDING_RULES.WAC).toBeUndefined();          // like Building Permit
    expect(SEEDING_RULES['Building Permit']).toBeUndefined();
    expect(defaultDaysForType('WAC')).toBe(defaultDaysForType('a type nobody has'));
    expect(defaultDaysForType('WAC')).toBeGreaterThan(0);
  });

  it('★ WAC has no description yet, which is normal and Bobby-editable', () => {
    // 6 of the 16 existing types carry no description either. fix-288 moved
    // descriptions into app_config where the Settings editor writes them, and
    // the TS seed is a FALLBACK that loses to the live key — so adding one here
    // would render nowhere and would be a third data change besides.
    expect(PERMIT_DESCRIPTION_SEED.WAC).toBeUndefined();
    expect(Object.keys(PERMIT_DESCRIPTION_SEED)).not.toContain('WAC');
  });

  it('★★★ "Review WAC and send out" is KEPT, and the file says why', () => {
    // The brief: do not delete it without saying what replaces it. Nothing
    // replaces it yet — no WAC permit exists on any project, so the checkbox is
    // still the only trace of a required permit. Deleting it today would lose
    // the tracking rather than move it.
    expect(MIGRATION).toMatch(/Review WAC and send out/);
    expect(MIGRATION).toMatch(/LEFT IN PLACE/);
    // And the condition for removing it later is written down, not implied.
    expect(MIGRATION).toMatch(/becomes deletable/);
  });
});

// ---------------------------------------------------------------------------
// §4 — approved → issued: the finding, asserted rather than described
// ---------------------------------------------------------------------------

describe('fix-349 §4: approved → issued needs nothing built, and here is why', () => {
  it('★★★ the two results_ready variants are MUTUALLY EXCLUSIVE by permit type', () => {
    // This is the whole answer. fix-181's trigger fires on approval_date for
    // the no-issuance types and on actual_issue for everything else — so an
    // issuing permit never gets an approved task to discard, and a no-issuance
    // permit never gets an issued one, because for those approval IS the end.
    // Confirmed on prod: of 132 results_ready tasks, permits carrying BOTH: 0.
    const trigger = FIX181.slice(FIX181.indexOf('bp_permit_results_ready_autotask'));
    expect(trigger).toMatch(/IF v_no_issuance THEN[\s\S]*approval_date IS NULL AND NEW\.approval_date IS NOT NULL[\s\S]*v_basis := 'approved'/);
    expect(trigger).toMatch(/ELSE[\s\S]*actual_issue IS NULL AND NEW\.actual_issue IS NOT NULL[\s\S]*v_basis := 'issued'/);
  });

  it('★★ so fix-337\'s results_ready carve-out is left exactly as it was', () => {
    // It excludes results_ready by name. Narrowing it would close the ONE open
    // approved task on prod — 003976-26PA, a PAR/Pre-Sub approved and "issued"
    // the same day — and for a PAR that task is the right task and the only
    // one. Closing it would delete the sole "send out results" prompt.
    expect(FIX337).toMatch(/AND t\.auto_event IS DISTINCT FROM 'results_ready'/);
    expect(SQL).not.toMatch(/bp_clear_tasks_for_issued_permit/);
    expect(SQL).not.toMatch(/auto_closed_reason/);
  });
});

// ---------------------------------------------------------------------------
// Prior contracts
// ---------------------------------------------------------------------------

describe('fix-349: prior contracts survive', () => {
  it('★ fix-292\'s one-day target and explicit-dates-at-creation still hold', () => {
    expect(SQL).toMatch(/v_target_days\s+constant integer := 1;/);
    expect(SQL).toMatch(/start_date, target_date/);
  });

  it('★ fix-157\'s security model is carried forward verbatim', () => {
    expect(SQL).toMatch(/SECURITY DEFINER/);
    expect(SQL).toMatch(/SET search_path TO 'public', 'pg_temp'/);
    expect(SQL).toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/);
    expect(SQL).toMatch(/auth_tenant_ids\(\)/);
  });

  it('★ the migration writes to exactly three tables, and permits is not one', () => {
    const written = new Set<string>();
    for (const m of SQL.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(\w+)/gi)) {
      written.add(m[1]!);
    }
    // permit_tasks appears only INSIDE the function body, as its normal job.
    expect([...written].sort()).toEqual(['permit_tasks', 'permit_types', 'task_templates']);
    expect(written.has('permits')).toBe(false);
    expect(written.has('projects')).toBe(false);
  });
});
