import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_395_city_target_chase_task.sql?raw';
import {
  CITY_CHASE_EPOCH,
  CITY_CHASE_EVENT,
  STATUS_CITY_HAS_RESPONDED,
  STATUS_NOT_WITH_CITY,
  chaseDecision,
  chaseTaskTitle,
  chaseableSince,
  cityOwesReview,
  daysChaseable,
} from '../lib/cityChase';
import {
  AGING_LADDER,
  cityTargetChaseable,
  nextBusinessDay,
} from '../lib/boardAging';
import { cityDateForEvent } from '../lib/lifecycleTaskDates';
import { shouldRunChaseSweep } from '../hooks/useCityChaseSweep';
import { AUTO_CLOSED_REASONS } from '../lib/database.types';

// ===========================================================================
// fix-395 — the chase is a prompt nobody owns; make it a task
// ===========================================================================
//
// Register #fix-305b. The incident: BLD2026-0770 sat 41 days with nobody
// answering the city. fix-305 built the ladder and the board's "go chase"
// prompt; a prompt is something you LOOK AT, and nobody was looking.
//
// ★★★ MEASURED ON PROD 2026-08-24, and the numbers are the whole §4 argument:
// 20 permits are chaseable 7+ days today and clear the date/hold gates — 16 of
// them Miles's. The status gate (bp_city_owes_review) removes 9 of those as
// "the city already answered", leaving 11 — 10 Miles, 1 Briana. A first sweep
// run without the epoch would have dumped all 11 on two people in one morning.
//
// ★★★ THE SQL HALF WAS EXERCISED AGAINST PRODUCTION inside a transaction that
// ends in RAISE EXCEPTION; nothing persisted. Every gate below was confirmed
// live (day 6 -> below_ladder, day 7 -> MINT, permit hold -> held, project hold
// -> held, cancelled -> cancelled, backfill -> backfill, Corrections Required /
// Withdrawn / Published / approved -> city_responded, and a moved target
// auto-closing the task as superseded_target_changed through the trigger).
// The transcript is in the PR body. CI has no live DB, so the mirrors below ARE
// the tested contract — this repo's fix-153 pattern.

/** ★ Comment-stripped, because the header discusses every status name at
 *  length in prose — the trap fix-387 and fix-390 both hit. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

/** The body of one SQL function, so an assertion cannot accidentally match
 *  another function's text. */
function fnBody(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} not found in the migration`).toBeGreaterThan(-1);
  const end = SQL.indexOf('$function$;', start);
  return SQL.slice(start, end);
}

const TODAY = '2026-09-30'; // a Wednesday, well past the epoch

/** A permit that clears every gate, so each test can break exactly one thing. */
function clear(over: Partial<Parameters<typeof chaseDecision>[0]> = {}) {
  return chaseDecision({
    cityTarget: '2026-09-18', // Friday -> chaseable Monday the 21st -> 9 days
    status: 'Reviews In Process',
    today: TODAY,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// §1 · THE TRIGGER
// ---------------------------------------------------------------------------

describe('fix-395 §1: 7 days of chaseable, then a task', () => {
  it('★★★ day 6 chaseable raises nothing; day 7 raises the task', () => {
    // A Monday target: chaseable from Tuesday, so day N is Tuesday + N.
    const target = '2026-09-07'; // Monday
    expect(chaseableSince(target)).toBe('2026-09-08');

    const day6 = chaseDecision({ cityTarget: target, status: 'In Review', today: '2026-09-14' });
    expect(day6.daysChaseable).toBe(6);
    expect(day6.mint).toBe(false);
    expect(day6.reason).toBe('below_ladder');

    const day7 = chaseDecision({ cityTarget: target, status: 'In Review', today: '2026-09-15' });
    expect(day7.daysChaseable).toBe(7);
    expect(day7.mint).toBe(true);
    expect(day7.reason).toBeNull();
  });

  it('★★ the rung is fix-305\'s own constant, not a second 7', () => {
    // If somebody re-tunes the ladder, this moves with it rather than drifting.
    expect(AGING_LADDER.task).toBe(7);
    const target = '2026-09-07';
    const onTheRung = daysChaseable(target, '2026-09-15');
    expect(onTheRung).toBe(AGING_LADDER.task);
  });

  it('★★★ the clock starts when it became CHASEABLE, not at the target', () => {
    // The two differ by the grace, and conflating them would fire 1-3 days
    // early — every weekend, on every Friday target.
    const friday = '2026-09-18';
    expect(chaseableSince(friday)).toBe('2026-09-21'); // Monday
    const d = chaseDecision({ cityTarget: friday, status: 'In Review', today: '2026-09-25' });
    expect(d.daysChaseable).toBe(4); // chaseable Mon..Fri
    expect(d.daysSinceTarget).toBe(7); // ...but 7 days since the target
    expect(d.mint).toBe(false); // ★ and the TRIGGER uses the chaseable clock
  });

  it('★ the grace/weekend rule is INHERITED, not reimplemented — asserted by calling it', () => {
    // Every one of these is fix-305's own function answering; this file has no
    // weekend arithmetic of its own to get wrong.
    expect(cityTargetChaseable('2026-09-18', '2026-09-19')).toBe(false); // Sat
    expect(cityTargetChaseable('2026-09-18', '2026-09-20')).toBe(false); // Sun
    expect(cityTargetChaseable('2026-09-18', '2026-09-21')).toBe(true); // Mon
    expect(chaseableSince('2026-09-18')).toBe(nextBusinessDay('2026-09-18'));
    // ...and a target that has not come due yet is refused by name.
    expect(clear({ cityTarget: '2026-10-30' }).reason).toBe('not_yet_chaseable');
  });

  it('★★★ the SQL closed form matches the TS loop, every day for two years', () => {
    // The sweep and the gate cannot run nextBusinessDay's while-loop, so they
    // carry `Fri +3, Sat +2, Sun +1, else +1`. That is the twin most likely to
    // rot silently, so it is pinned exhaustively rather than sampled.
    const closedForm = (iso: string): string => {
      const d = new Date(`${iso}T12:00:00Z`);
      const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // 1=Mon .. 7=Sun
      const add = isoDow === 5 ? 3 : isoDow === 6 ? 2 : 1;
      d.setUTCDate(d.getUTCDate() + add);
      return d.toISOString().slice(0, 10);
    };
    const start = Date.parse('2026-01-01T12:00:00Z');
    for (let i = 0; i < 730; i++) {
      const iso = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      expect(closedForm(iso), `mismatch at ${iso}`).toBe(nextBusinessDay(iso));
    }
    // And the migration really does carry that closed form.
    expect(fnBody('bp_chase_blocked_reason')).toMatch(
      /WHEN 5 THEN 3 WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 1 END/,
    );
  });

  it('★ no target is not a chase — it is nothing to chase', () => {
    expect(clear({ cityTarget: null }).reason).toBe('no_target');
    expect(clear({ cityTarget: '  ' }).reason).toBe('no_target');
  });
});

// ---------------------------------------------------------------------------
// §2 · WHAT MUST NOT FIRE
// ---------------------------------------------------------------------------

describe('fix-395 §2: every silence gate blocks minting', () => {
  it('★ the control mints, so each block below is the ONE thing changed', () => {
    expect(clear().mint).toBe(true);
  });

  it('★★★ a permit hold silences it (fix-390)', () => {
    expect(clear({ isHeld: true })).toMatchObject({ mint: false, reason: 'held' });
  });

  it('★★★ a PROJECT hold silences it too — both scopes (fix-391)', () => {
    // The caller passes the union (isPermitHeld), which is why one flag covers
    // both scopes here; fix-391's ruling is that "on hold" means quiet at
    // either. The prod probe exercised the two separately and both returned
    // `held`.
    expect(clear({ isHeld: true }).reason).toBe('held');
    expect(fnBody('bp_chase_blocked_reason')).toMatch(/FROM public\.permit_holds/);
    expect(fnBody('bp_chase_blocked_reason')).toMatch(/FROM public\.project_holds/);
  });

  it('★★★ a cancelled project silences it (fix-262), and cancel is not hold', () => {
    expect(clear({ isCancelledProject: true })).toMatchObject({
      mint: false,
      reason: 'cancelled',
    });
    // ★ Distinct reasons, because they are distinct facts — fix-391's
    // CANCEL IS NOT HOLD, carried through to the escalation.
    expect(clear({ isHeld: true }).reason).not.toBe(
      clear({ isCancelledProject: true }).reason,
    );
  });

  it('★★★ a terminal / answered status silences it (fix-388)', () => {
    for (const s of ['Corrections Required', 'Withdrawn', 'Approved', 'Issued', 'Published']) {
      expect(clear({ status: s }), s).toMatchObject({ reason: 'city_responded' });
    }
  });

  it('★★★ backfill-flagged silences it — but ONLY on an explicit true (fix-386)', () => {
    expect(clear({ isBackfillProject: true }).reason).toBe('backfill');
    // ★★ Nullable means NOT RECORDED. The flag ADDS suppression on true and
    // never removes it on false — fix-386's rule, restated where it bites.
    expect(clear({ isBackfillProject: null }).mint).toBe(true);
    expect(clear({ isBackfillProject: false }).mint).toBe(true);
    expect(clear({ isBackfillProject: undefined }).mint).toBe(true);
  });

  it('★ sub-permits: whatever the ladder does — and buildAging skips them', () => {
    expect(clear({ isSubPermit: true }).reason).toBe('sub_permit');
  });

  it('★★ dates beat status, boardAging\'s own rule', () => {
    // A permit the city approved is not chaseable even while its status still
    // reads "Reviews In Process" — the Concord STFI shape.
    expect(clear({ approvalDate: '2026-09-20' }).reason).toBe('city_responded');
    expect(clear({ corrIssued: '2026-09-20' }).reason).toBe('city_responded');
    expect(clear({ actualIssue: '2026-09-20' }).reason).toBe('issued');
  });

  it('★★ NO_ISSUANCE types inherit the ladder\'s behaviour: no special case', () => {
    // buildAging does not mention NO_ISSUANCE_PERMIT_TYPES at all, so neither
    // does the escalation. A ULS past its target is chased like anything else —
    // and 3 of the 11 reported permits are IPR/ULS-family rows, so this is a
    // live behaviour, not a hypothetical.
    expect(clear({ status: 'Reviews In Process' }).mint).toBe(true);
  });

  it('★★ no notification burst — the chase reuses what bot tasks already do', () => {
    // fix-360's grouping already carries bot tasks to the bell, so a chase task
    // reaches it the way every other one does. Two structural assertions:
    //
    //   1. the migration opens no notification path of its own, and
    const outside = SQL.replace(/AS \$function\$[\s\S]*?\$function\$;/g, ' [body] ');
    expect(SQL).not.toMatch(/INSERT INTO public\.(notifications|board_item|whats_new)/i);
    expect(outside).not.toMatch(/permit_task_auto_closures/);
    //   2. the ONE ledger the auto-clear writes is the existing shared one, at
    //      its existing grain (one row per permit per recipient), which is what
    //      keeps a closed chase task quiet rather than louder.
    const closer = fnBody('bp_supersede_stale_bot_tasks');
    expect(closer).toMatch(/INSERT INTO public\.permit_task_auto_closures/);
    expect(closer).toMatch(/GROUP BY tenant_id, permit_id, recipient/);
  });
});

// ---------------------------------------------------------------------------
// §3 · THE ANCHOR
// ---------------------------------------------------------------------------

describe('fix-395 §3: one task per permit per target', () => {
  it('★★★ the anchor IS the city_target value', () => {
    expect(clear().anchor).toBe('2026-09-18');
  });

  it('★★★ the same target never mints twice, and a NEW target may', () => {
    // Idempotency is the partial unique index, so it is asserted on the DDL.
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS permit_tasks_city_chase_uniq\s+ON public\.permit_tasks \(tenant_id, permit_id, auto_anchor\)/,
    );
    // ★★★ AND THERE IS NO STATUS IN THE PREDICATE. That is what makes a human's
    // "I already called them" stick: a Resolved row still occupies the slot, so
    // ON CONFLICT DO NOTHING returns NULL on every re-fire for that target.
    // Deliberately NOT the scrape_reconcile shape, which re-mints once closed.
    const idx = SQL.slice(
      SQL.indexOf('permit_tasks_city_chase_uniq'),
      SQL.indexOf('permit_tasks_city_chase_uniq') + 260,
    );
    expect(idx).toMatch(/WHERE is_auto_generated = true AND auto_event = 'city_target_chase'/);
    expect(idx).not.toMatch(/completion_status/);
  });

  it('★★★ the OLD index had to stop covering the chase event', () => {
    // Otherwise it would collapse every chase task for a permit into one slot
    // regardless of anchor — exactly the bug the anchor exists to prevent.
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX permit_tasks_auto_event_uniq[\s\S]{0,240}auto_event NOT IN \('scrape_reconcile', 'city_target_chase'\)/,
    );
  });

  it('★★ the ON CONFLICT predicate matches the index, or inference fails', () => {
    const minter = fnBody('bp_create_lifecycle_task');
    expect(minter).toMatch(
      /ON CONFLICT \(tenant_id, permit_id, auto_anchor\)\s+WHERE is_auto_generated = true AND auto_event = 'city_target_chase'/,
    );
  });

  it('★★ auto_anchor is nullable — every pre-fix-395 bot task keeps NULL', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS auto_anchor text;/);
    expect(SQL).not.toMatch(/auto_anchor text NOT NULL/);
    // ...and nothing backfills it.
    expect(SQL).not.toMatch(/UPDATE public\.permit_tasks\s+SET auto_anchor/);
  });
});

// ---------------------------------------------------------------------------
// §4 · THE BACKFILL — LIST, DO NOT MINT
// ---------------------------------------------------------------------------

describe('fix-395 §4: nothing pre-existing is minted', () => {
  it('★★★ a target already chaseable at the epoch never mints', () => {
    // The 11 reported permits all became chaseable between 2026-05-11 and
    // 2026-08-17 — every one of them lands here.
    const old = chaseDecision({
      cityTarget: '2026-05-08',
      status: 'Reviews In Process',
      today: TODAY,
    });
    expect(old.daysChaseable).toBeGreaterThan(100); // long past the rung
    expect(old.mint).toBe(false);
    expect(old.reason).toBe('pre_epoch');
  });

  it('★★★ ...and one that crosses AFTER the epoch does', () => {
    const fresh = chaseDecision({
      cityTarget: '2026-09-18',
      status: 'Reviews In Process',
      today: TODAY,
    });
    expect(fresh.mint).toBe(true);
  });

  it('★★ the epoch boundary is strictly-after, not on-or-after', () => {
    // A target that became chaseable ON the epoch belongs to the pre-existing
    // population, not to the new crossings.
    const onEpoch = chaseDecision({
      cityTarget: '2026-08-21', // Friday -> chaseable Monday 2026-08-24
      status: 'In Review',
      today: TODAY,
      epoch: CITY_CHASE_EPOCH,
    });
    expect(chaseableSince('2026-08-21')).toBe(CITY_CHASE_EPOCH);
    expect(onEpoch.reason).toBe('pre_epoch');
  });

  it('★★★ the epoch means NOTHING could mint before 2026-09-01', () => {
    // The earliest post-epoch crossing is 2026-08-25, plus the 7-day rung. So
    // shipping this cannot produce a single task for a week — which is the §4
    // guarantee expressed as a date rather than a promise.
    const earliest = chaseDecision({
      cityTarget: '2026-08-24', // Monday -> chaseable Tue 2026-08-25
      status: 'In Review',
      today: '2026-08-31',
    });
    expect(earliest.mint).toBe(false);
    expect(chaseDecision({ cityTarget: '2026-08-24', status: 'In Review', today: '2026-09-01' }).mint)
      .toBe(true);
  });

  it('★★ the TS epoch and the SQL epoch are the same date', () => {
    expect(fnBody('bp_generate_city_chase_tasks')).toContain(
      `DATE '${CITY_CHASE_EPOCH}'`,
    );
  });

  it('★★ the epoch lives in the SWEEP only, never in the gate', () => {
    // It is a deployment policy about the first run, not a property of whether
    // a permit deserves chasing — so approving the backfill later moves ONE
    // constant and leaves the gate untouched.
    expect(fnBody('bp_chase_blocked_reason')).not.toContain(CITY_CHASE_EPOCH);
  });
});

// ---------------------------------------------------------------------------
// §5 · THE TWINS
// ---------------------------------------------------------------------------

describe('fix-395 §5: TS and SQL say the same thing', () => {
  it('★★★ the status vocabulary matches, value for value', () => {
    const body = fnBody('bp_city_owes_review');
    const list = body.slice(body.indexOf('IN ('), body.indexOf('    ) THEN false'));
    const sqlValues = new Set(
      [...list.matchAll(/'((?:[^']|'')+)'/g)].map((m) => m[1]!.replace(/''/g, "'")),
    );
    const tsValues = new Set([...STATUS_CITY_HAS_RESPONDED, ...STATUS_NOT_WITH_CITY]);

    const missingInSql = [...tsValues].filter((v) => !sqlValues.has(v));
    const missingInTs = [...sqlValues].filter((v) => !tsValues.has(v));
    expect({ missingInSql, missingInTs }).toEqual({ missingInSql: [], missingInTs: [] });
  });

  it('★★ and the predicate agrees on every value either side knows', () => {
    for (const s of [...STATUS_CITY_HAS_RESPONDED, ...STATUS_NOT_WITH_CITY]) {
      expect(cityOwesReview(s), s).toBe(false);
    }
    for (const s of ['Reviews In Process', 'In Review', 'Under Review', 'Applied',
                     'In Process', 'Application Completed', 'Corrections Submitted']) {
      expect(cityOwesReview(s), s).toBe(true);
    }
  });

  it('★★ a blank or unknown status does not block — the other gates decide', () => {
    expect(cityOwesReview(null)).toBe(true);
    expect(cityOwesReview('')).toBe(true);
    expect(cityOwesReview('Some Brand New Portal String')).toBe(true);
  });

  it('★★ exact match after trimming, never a substring test (fix-388\'s rule)', () => {
    expect(cityOwesReview('  Corrections Required  ')).toBe(false);
    // A fuzzy /correct/i would catch this; an enumerated set correctly does not.
    expect(cityOwesReview('Corrections Submitted')).toBe(true);
    // Case-sensitive on purpose: a case difference is a NEW status to look at.
    expect(cityOwesReview('corrections required')).toBe(true);
  });

  it('★★ the event is in every vocabulary that must carry it', () => {
    expect(CITY_CHASE_EVENT).toBe('city_target_chase');
    // The SQL whitelist, or the RPC raises 22023.
    expect(fnBody('bp_create_lifecycle_task')).toMatch(
      /IF p_event NOT IN\s*\n?\s*\([^)]*'city_target_chase'\)/,
    );
    // The close-reason CHECK and its TS mirror.
    expect(SQL).toMatch(/'superseded_city_responded',/);
    expect(SQL).toMatch(/'superseded_target_changed'/);
    expect(AUTO_CLOSED_REASONS).toContain('superseded_city_responded');
    expect(AUTO_CLOSED_REASONS).toContain('superseded_target_changed');
  });

  it('★★ the city date for a chase task is the TARGET (fix-349\'s contract)', () => {
    expect(
      cityDateForEvent('city_target_chase', { cycle: { city_target: '2026-09-18' } }),
    ).toBe('2026-09-18');
    // ★ and the SQL reads the same column.
    expect(fnBody('bp_create_lifecycle_task')).toMatch(
      /WHEN 'city_target_chase' THEN v_cycle\.city_target/,
    );
  });

  it('★★★ the title twin', () => {
    expect(chaseTaskTitle('2026-09-18', '2026-09-25', '7122473-CN')).toBe(
      'Chase the city — target was 2026-09-18, 7 days ago — 7122473-CN',
    );
    // ★ Singular on day one, because "1 days ago" is how a tool loses trust.
    expect(chaseTaskTitle('2026-09-18', '2026-09-19', 'X')).toContain('1 day ago');
    expect(fnBody('bp_create_lifecycle_task')).toMatch(
      /THEN ' day ago — ' ELSE ' days ago — ' END/,
    );
  });
});

// ---------------------------------------------------------------------------
// §5b · THE SWEEP, AND WHY IT IS A SWEEP
// ---------------------------------------------------------------------------

describe('fix-395 §5b: the daily sweep', () => {
  it('★★★ it is a SWEEP, not a trigger — because nothing HAPPENS on day 7', () => {
    // Every other lifecycle task is minted by a city ACTION, so a trigger has a
    // row to hang on. This one is minted by time passing, which is precisely
    // the problem the ticket exists to solve. So it takes the only shape the
    // engine already has for time-based work: bp_generate_number_entry_tasks.
    const sweep = fnBody('bp_generate_city_chase_tasks');
    expect(sweep).toMatch(/FROM public\.app_sweeps/);
    expect(sweep).toMatch(/sweep_name = 'city_target_chase'/);
    expect(sweep).toMatch(/last_swept_on >= v_today/);
    // ★ Its own sweep name, so it cannot starve or be starved by the sibling.
    expect(sweep).not.toMatch(/'number_entry'/);
    // ★ No trigger is created for the MINT half anywhere in the migration.
    expect(SQL).not.toMatch(/CREATE TRIGGER[\s\S]{0,200}bp_generate_city_chase_tasks/);
  });

  it('★★ it counts only what was actually made', () => {
    // bp_create_lifecycle_task returns NULL when the anchor suppresses a
    // duplicate, so the count is mints and not attempts — the sibling's rule.
    expect(fnBody('bp_generate_city_chase_tasks')).toMatch(
      /IF v_made IS NOT NULL THEN v_count := v_count \+ 1; END IF;/,
    );
  });

  it('★★ the same silence gates again, in the sweep\'s own WHERE', () => {
    // Belt and braces on purpose: the gate inside the minter is the guarantee,
    // and these keep the sweep from doing pointless per-permit RPC work.
    const sweep = fnBody('bp_generate_city_chase_tasks');
    expect(sweep).toMatch(/FROM public\.project_holds/);
    expect(sweep).toMatch(/FROM public\.permit_holds/);
    expect(sweep).toMatch(/COALESCE\(pr\.is_backfill, false\) = false/);
    expect(sweep).toMatch(/p\.parent_permit_id IS NULL/);
    expect(sweep).toMatch(/public\.bp_city_owes_review\(p\.status\)/);
  });

  it('★★ the client guard is a courtesy; the server guard is the real one', () => {
    expect(shouldRunChaseSweep(null, '2026-09-30')).toBe(true);
    expect(shouldRunChaseSweep('2026-09-29', '2026-09-30')).toBe(true);
    expect(shouldRunChaseSweep('2026-09-30', '2026-09-30')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §6 · PRIOR CONTRACTS SURVIVE
// ---------------------------------------------------------------------------

describe('fix-395 §6: nothing already shipped is disturbed', () => {
  it('★★★ the mint gate and the auto-clear are the same predicate, negated', () => {
    // The prod probe found why this matters: minting on a permit whose cycle
    // already carried corr_issued produced a task the auto-clear closed in the
    // same breath. The gate now runs inside the MINTER, so every caller —
    // including the scraper, which holds service_role on that RPC — gets it.
    expect(fnBody('bp_create_lifecycle_task')).toMatch(
      /IF p_event = 'city_target_chase'\s*\n\s*AND public\.bp_chase_blocked_reason\(p_permit_id, p_cycle_idx\) IS NOT NULL THEN/,
    );
  });

  it('★★ fix-355\'s person guard is untouched — start_date is still not a touch', () => {
    const closer = fnBody('bp_supersede_stale_bot_tasks');
    expect(closer).toMatch(/AND NOT public\.bp_task_touched_by_person\(t\.id\)/);
    expect(closer).not.toMatch(/t\.start_date/);
  });

  it('★★ the five pre-existing supersede rules are all still there', () => {
    const closer = fnBody('bp_supersede_stale_bot_tasks');
    for (const rule of [
      'superseded_resubmitted',
      'superseded_next_cycle',
      'superseded_by_intake_acceptance',
      'superseded_status_matched',
      'superseded_number_present',
    ]) {
      expect(closer, rule).toContain(rule);
    }
  });

  it('★★ "the city responded" is ordered BEFORE "the target moved"', () => {
    const closer = fnBody('bp_supersede_stale_bot_tasks');
    expect(closer.indexOf('superseded_city_responded')).toBeLessThan(
      closer.indexOf('superseded_target_changed'),
    );
  });

  it('★★ the chase task is a NORMAL permit task — nothing bespoke', () => {
    const minter = fnBody('bp_create_lifecycle_task');
    // ent discipline + pm bucket, assigned_to deliberately absent (fix-156):
    // ownership is DERIVED at read time by fix-238/308 routing, and fix-368's
    // co-assign trigger fires on the insert like any other task.
    expect(minter).not.toMatch(/assigned_to/);
    // ★★★ NOT priority: fix-305's ladder already has a `priority` rung at 21
    // days, and marking every 7-day chase urgent would flatten that.
    const chaseBranch = minter.slice(minter.indexOf("WHEN 'city_target_chase' THEN"));
    expect(chaseBranch.slice(0, 600)).not.toMatch(/v_priority := true/);
  });

  it('★★ the trigger columns widen, and that is deliberate', () => {
    // `city_target` was not in the cycle trigger's UPDATE OF list, so a moved
    // target could never have reached superseded_target_changed — the rule
    // would have been dead code. `approval_date` was absent from the permits
    // list too.
    expect(SQL).toMatch(
      /AFTER INSERT OR UPDATE OF submitted, intake_accepted, corr_issued, resubmitted, city_target/,
    );
    expect(SQL).toMatch(/AFTER UPDATE OF status, num, approval_date ON public\.permits/);

    // ★★★ THE ONE PRE-EXISTING RULE THIS TOUCHES, NAMED RATHER THAN DISCOVERED.
    // `superseded_by_intake_acceptance` already reads approval_date as
    // sufficient evidence; before, it simply had to wait for some OTHER trigger
    // to re-evaluate it. Widening the columns makes fix-355's own rule fire
    // sooner — it does not change what the rule decides, and
    // bp_task_touched_by_person still guards every close.
    const closer = fnBody('bp_supersede_stale_bot_tasks');
    expect(closer).toMatch(/superseded_by_intake_acceptance[\s\S]{0,40}/);
    expect(closer).toMatch(/c\.approval_date IS NOT NULL/);
    // A city_target-only edit changes no pre-existing rule's inputs, so those
    // rules re-evaluate to the same verdict they already had.
    for (const col of ['resubmitted', 'intake_accepted', 'corr_issued', 'num']) {
      expect(closer, col).toContain(col);
    }
  });

  it('★★★ the ladder itself is untouched — the prompt stays, the task escalates', () => {
    // fix-305's rungs, its predicate and its deploy epoch are all as they were;
    // this ticket adds a consumer, it does not retune the ladder.
    expect(AGING_LADDER).toEqual({ acknowledge: 3, task: 7, priority: 21 });
    expect(cityTargetChaseable('2026-09-18', '2026-09-21')).toBe(true);
  });

  it('★★★ no row is written when the migration RUNS', () => {
    // ★★ THE DISTINCTION THAT MAKES THIS ASSERTABLE: the migration is full of
    // INSERT statements, and every one of them is inside a `$function$ ... $`
    // body — code that runs later, when the sweep fires, not now. So the
    // function bodies are stripped and the assertion is made on what is LEFT,
    // which is the only SQL the migration itself executes. Asserting on the
    // raw text would fail on the minter's own INSERT and prove nothing.
    const outside = SQL.replace(/AS \$function\$[\s\S]*?\$function\$;/g, ' [body] ');
    expect(outside).toMatch(/\[body\]/); // the stripper actually stripped
    expect(outside).not.toMatch(/\bINSERT INTO\b/i);
    expect(outside).not.toMatch(/\bUPDATE\s+public\./i);
    expect(outside).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(outside).not.toMatch(/\bTRUNCATE\b/i);
    // ★ And nothing backfills the new column either.
    expect(SQL).not.toMatch(/SET auto_anchor\s*=/);
  });
});
