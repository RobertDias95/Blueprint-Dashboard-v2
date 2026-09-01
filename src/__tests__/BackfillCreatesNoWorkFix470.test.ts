import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_470_backfill_creates_no_work.sql?raw';
import FIX395 from '../../migrations/fix_395_city_target_chase_task.sql?raw';
import { EARLIEST_QUARTER, buildQuarterOptions } from '../lib/teamQuarterHelpers';
import { milestoneIsHistory, historicSuppressedKinds } from '../lib/myBoard';
import { chaseDecision } from '../lib/cityChase';
import type { PermitWithCycles } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-470 (P-110 + P-123) — A BACKFILL CREATES NO WORK
// ===========================================================================
//
// Bobby, 2026-08-31: *"in the add new project, at the very top, backfill
// historical project, when checking this, we dont want tasks or milestones
// created."*
//
// ⏰ THIS HAD A CLOCK: he is entering a year of 2024 projects by hand.
//
// MEASURED ON PROD 2026-09-01, before anything was written:
//
//     projects with is_backfill = true         16    (0 false, 186 NULL)
//     permits on them                          41
//     permit_tasks on them                     44
//     ...of which auto-generated               44    ← every single one
//     ...created by a person                    0
//
// ★★★ THE SQL HALF WAS PROVED AGAINST PRODUCTION in a transaction ending in
// ROLLBACK — nothing persisted. A throwaway project + permit + cycle was
// created inside it so no pre-existing row could mask a result through
// `ON CONFLICT DO NOTHING`, and the guard was driven through all three flag
// states with FOUR different lifecycle events each:
//
//     is_backfill = TRUE   → 4 events → **0 rows**   (and NULL returned)
//     is_backfill = FALSE  → same 4   → **4 rows**
//     is_backfill = NULL   → a 5th    → **5 rows**   (the 186-project case)
//
// ★★ There is no live database in CI (fix-153's rule), so this file is the
// pure-TS mirror: it pins the migration's TEXT against the shape that probe
// exercised, and pins every client-side rule that shares the flag.

// ---------------------------------------------------------------------------
// §1 — the guard
// ---------------------------------------------------------------------------
describe('fix-470 §1 — the lifecycle chokepoint refuses a backfilled project', () => {
  it('★★★ the guard returns NULL on is_backfill, in bp_create_lifecycle_task', () => {
    // The spliced-in text, asserted as the migration will emit it.
    expect(MIGRATION).toContain('SELECT address, COALESCE(is_backfill, false)');
    expect(MIGRATION).toContain('INTO v_project_addr, v_is_backfill');
    expect(MIGRATION).toContain('IF v_is_backfill THEN');
    expect(MIGRATION).toContain('RETURN NULL;');
    expect(MIGRATION).toContain('bp_create_lifecycle_task');
  });

  it('★★★ COALESCE, NOT `IS NOT TRUE` — NULL still means "nobody was asked"', () => {
    // ★★★ THE ONE A CARELESS IMPLEMENTATION BREAKS. 186 of 202 projects are
    //     NULL; `IS NOT TRUE` would have silenced every one of them and the
    //     symptom would be "the app stopped making tasks", days later.
    expect(MIGRATION).toContain('COALESCE(is_backfill, false)');
    expect(MIGRATION).not.toMatch(/is_backfill\s+IS\s+NOT\s+TRUE/i);
    expect(MIGRATION).not.toMatch(/is_backfill\s+IS\s+DISTINCT\s+FROM\s+false/i);
  });

  it('★★★ it matches fix-395\'s existing predicate rather than inventing a second', () => {
    // ★★ The rule was already written by this team, in this repo — and applied
    //    to ONE generator only. The guard makes that line redundant rather
    //    than contradicted, which is why fix-395's copy is left in place.
    expect(FIX395).toContain('COALESCE(pr.is_backfill, false) = false');
    // Same treatment of NULL on both sides of the app.
    expect(MIGRATION).toContain('COALESCE(is_backfill, false)');
  });

  it('★★★ ONE chokepoint — the three callers are named as unchanged', () => {
    // A guard in each caller is three copies of one rule, and this rule has
    // already drifted once (fix-395 gated the chase generator and not the
    // other two). The migration states the callers it does NOT touch.
    for (const caller of [
      'bp_generate_city_chase_tasks',
      'bp_generate_number_entry_tasks',
      'bp_permit_results_ready_autotask',
    ]) {
      expect(MIGRATION).toContain(caller);
    }
    // ★ …and it must not CREATE OR REPLACE any of them.
    expect(MIGRATION).not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.bp_generate_/i,
    );
    expect(MIGRATION).not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.bp_permit_results_ready/i,
    );
  });

  it('★★★ FORWARD-ONLY: the migration writes no rows at all', () => {
    // ★★★ Bobby took the strictest option over a recommended sweep. This is a
    //     CREATION rule, not a cleanup. Asserted as a property of the file so
    //     a later edit cannot quietly add a sweep to it.
    //
    // ★ Only comment lines and the string literals the function body is built
    //   from may mention these words; no statement may execute one.
    const statements = MIGRATION.split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .filter((l) => !l.includes("E'")) // the spliced function text
      .join('\n');
    expect(statements).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(statements).not.toMatch(/\bUPDATE\s+public\./i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('★★ patched by ANCHOR, and it refuses to splice if prod has drifted', () => {
    // fix-410 / fix-425's rule: never retype a 200-line live function to add
    // four lines. And an anchor patch that silently matches zero times is
    // worse than one that fails — both anchors are asserted to appear exactly
    // once before anything is spliced.
    expect(MIGRATION).toContain('pg_get_functiondef');
    expect(MIGRATION).toContain('not found exactly once');
    expect(MIGRATION).toContain('prod has drifted');
    // ★ Idempotent: a second apply is a no-op, not a second guard.
    expect(MIGRATION).toMatch(/position\('fix-470' in v_def\) > 0/);
  });
});

// ---------------------------------------------------------------------------
// §1 — the client-side halves that already existed (STEP 0's answer)
// ---------------------------------------------------------------------------
function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p-1',
    type: 'Building Permit',
    created_at: '2026-01-01T00:00:00Z',
    target_submit: '2025-06-01',
    dd_end: '2025-05-01',
    intake_date: '2025-07-01',
    permit_cycles: [],
    ...over,
  } as unknown as PermitWithCycles;
}

describe('fix-470 §1 — milestones were ALREADY suppressed (nothing added)', () => {
  it('★★★ is_backfill = true silences the plan-date milestone kinds', () => {
    // fix-386 built this and it is unchanged by this ticket. STEP 0's job was
    // to prove it exists before writing any, and it does.
    for (const kind of ['target_submit', 'draw', 'intake'] as const) {
      expect(milestoneIsHistory(kind, permit(), true)).toBe(true);
    }
  });

  it('★★★ …and DELIBERATELY does not silence the present-state kinds', () => {
    // ★★ A backfilled project's unpaid fees are still genuinely unpaid TODAY.
    //    "This project is history" must not be heard as "stop telling me about
    //    its current state" — so `fees`, `corrections` and `reviewer_silent`
    //    read the portal's present and keep firing. That asymmetry is the
    //    reason nothing needed adding here.
    const p = permit({ created_at: '2020-01-01T00:00:00Z' });
    for (const kind of ['fees', 'corrections', 'reviewer_silent'] as const) {
      expect(milestoneIsHistory(kind, p, true)).toBe(false);
    }
  });

  it('★★ true ADDS suppression; false never REMOVES fix-378\'s date rule', () => {
    // The recorded answer beats the inference in ONE direction only.
    const dated = permit({ created_at: '2026-01-01T00:00:00Z', target_submit: '2025-06-01' });
    expect(milestoneIsHistory('target_submit', dated, false)).toBe(true); // the date rule still runs
    expect(milestoneIsHistory('target_submit', dated, null)).toBe(true);
    // A backfilled project whose dates look CURRENT is caught only by the flag.
    const current = permit({ created_at: '2020-01-01T00:00:00Z', target_submit: '2030-06-01' });
    expect(milestoneIsHistory('target_submit', current, null)).toBe(false);
    expect(milestoneIsHistory('target_submit', current, true)).toBe(true);
  });

  it('★★ a suppressed milestone is COUNTED, not silently dropped', () => {
    // fix-298's principle: showing the suppressed count is how a quiet day and
    // a broken notifier stop looking the same.
    const kinds = historicSuppressedKinds(permit(), [], true);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).toContain('target_submit');
  });

  it('★★ the chase decision already refuses a backfilled project too', () => {
    // fix-395's client mirror, unchanged — the same ruling on the other side
    // of the wire.
    // ★ The target must clear fix-395's day-one epoch (2026-08-24) first, or
    //   `pre_epoch` answers before the backfill gate is ever consulted — the
    //   gates are ordered and this test is about the LAST one.
    const args = { cityTarget: '2026-08-26', today: '2026-09-05' };
    expect(chaseDecision({ ...args, isBackfillProject: true } as never).reason).toBe(
      'backfill',
    );
    expect(chaseDecision({ ...args, isBackfillProject: true } as never).mint).toBe(
      false,
    );
    // ★★ fix-386's three states, on this side of the wire too: null and false
    //    both still mint. Same rule the SQL guard now enforces.
    expect(chaseDecision({ ...args, isBackfillProject: null } as never).mint).toBe(true);
    expect(chaseDecision({ ...args, isBackfillProject: false } as never).mint).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — the quarter floor
// ---------------------------------------------------------------------------
describe('fix-470 §2 — the floor is a DATE, and the ceiling still rolls', () => {
  it('★★★ 2023-Q1 whatever the clock says — including years from now', () => {
    // The full case list lives in teamQuarterHelpers.test.ts beside the
    // function; this is the one-line statement of the ruling.
    expect(EARLIEST_QUARTER).toBe('2023-Q1');
    expect(buildQuarterOptions(new Date('2026-09-01T12:00:00Z'))[0]).toBe('2023-Q1');
    expect(buildQuarterOptions(new Date('2029-09-01T12:00:00Z'))[0]).toBe('2023-Q1');
  });

  it('★★ both admin screens get it, because both take the defaults', () => {
    // ★ One change, two screens, and that is wanted: assigning a DA to a 2023
    //   column is useless if that DA cannot be marked active in 2023.
    //   `QuarterLayoutEditor` and `TeamActiveQuartersEditor` both call
    //   `buildQuarterOptions()` with no arguments.
    const opts = buildQuarterOptions(new Date('2026-09-01T12:00:00Z'));
    expect(opts).toContain('2024-Q1');
    expect(opts).toContain('2024-Q4');
    expect(opts.at(-1)).toBe('2028-Q3'); // 2026-Q3 + 8, still rolling
  });
});
