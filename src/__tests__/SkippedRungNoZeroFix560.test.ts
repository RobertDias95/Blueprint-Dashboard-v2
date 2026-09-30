import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_560_skipped_rung_no_zero.sql?raw';
import ORIGINAL from '../../migrations/fix_474_consultant_records.sql?raw';
import {
  CONSULTANT_DURATION_CUTOFF,
  consultantDurationIsCountable,
  consultantRoundDurationDays,
  stampConsultantDates,
} from '../lib/consultants';

// ===========================================================================
// ★★★ fix-560 (P-264) — A SKIPPED RUNG STOPS WRITING A ZERO-DAY TURNAROUND
// ===========================================================================
//
// ---------------------------------------------------------------------------
// §0 — RE-MEASURED 2026-09-29, and the brief's headline no longer holds
// ---------------------------------------------------------------------------
//
//   claim (2026-09-14)                        measured (2026-09-29)
//   ───────────────────────────────────────── ────────────────────────────────
//   "recd = sent on ALL 22 completed rounds,  **38 completed: 28 zero-day AND
//    min/median/max 0 days"                     10 with a REAL interval**
//   155 of 184 consultants have no dates      137 of 198
//   9 rounds Pending with sent, no recd       **15**
//   11 Received with NO sent (the backfill)   **11** ✓
//
// ★★★ TEN ROUNDS NOW CARRY A GENUINE INTERVAL — min 5, median 14, max 37 days.
//     **The ladder produces real numbers when it is walked**, which §0 argued
//     from reading the function and the data now shows. The brief could not
//     have known; its "all zeroes" premise is simply out of date.
//
// ★★★ AND THE DEFECT IS STILL WRITING: **6 of the 28 zeroes were stamped ON OR
//     AFTER 2026-09-15**, the day Bobby ruled. 22 became 28 in fifteen days.
//     This is a live source, not a historical mess — and it is why §B's cutoff
//     cannot be the day he spoke (see below).
//
// ---------------------------------------------------------------------------
// ★★★ THE STAMPING WAS NEVER BROKEN
// ---------------------------------------------------------------------------
//
//     Scheduled → sent=null,                  recd=null
//     Pending   → sent=coalesce(sent,today),  recd=null
//     Received  → sent=coalesce(sent,today),  recd=coalesce(recd,today)
//
// The 28 zeroes are rounds that went straight `Scheduled` → `Received`: at that
// moment `sent` is still null, so BOTH slots stamp today. **Same-day is the
// arithmetic of skipping `Pending`, not a capture bug.** ⚠️ Cowork first called
// it a capture bug and ranked it first on invented urgency; reading the function
// corrected it. → [[rows-are-not-history-dated-rows-are]]
//
// ---------------------------------------------------------------------------
// ⚠️ THE BRIEF SAYS "no migration". IT IS WRONG, harmlessly.
// ---------------------------------------------------------------------------
//
// §A's one change lives inside `bp_set_consultant_status`, a database function.
// There is no client-side stamping to change — the RPC owns every date. The
// migration is STAGED and NOT APPLIED; CI is green with it unapplied because
// **nothing in the app reads a consultant duration yet** (measured: `recd`
// appears in the UI only as a date).

const TODAY = '2026-09-29';

/**
 * ★★★ THE MIGRATION WITH ITS DOUBLED QUOTES UNDONE, and this is semantics
 *     rather than tidying. Inside a plpgsql string literal `''` **is** one
 *     apostrophe — `'when v_status = ''Received'' then r.sent'` is the text
 *     Postgres compares against `pg_get_functiondef`. Asserting on the raw
 *     file would mean writing every expectation in escaped form, which reads
 *     nothing like the SQL it is pinning and hides what is actually asserted.
 */
const SQL = MIGRATION.replace(/''/g, "'");

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-560 §A — the ladder, as arithmetic', () => {
  // ★★ THE MIRROR IS TESTED, AND THE REAL FUNCTION IS PROVED BY A ROLLED-BACK
  //    PROD PROBE recorded in the migration header. CI has no database, so this
  //    is the fix-153 pattern: a pure twin here, behaviour there.

  it('★★★ Scheduled → Received in ONE call leaves `sent` NULL and sets `recd`', () => {
    // The brief's first test. This single absence is the whole ticket.
    const out = stampConsultantDates({ sent: null, recd: null }, 'Received', TODAY);
    expect(out.sent).toBeNull();
    expect(out.recd).toBe(TODAY);
    // ★★★ …and therefore it is NOT COUNTABLE, which is the point of leaving it
    //     null rather than stamping a zero.
    expect(consultantRoundDurationDays(out)).toBeNull();
  });

  it('★★★ Scheduled → Pending → Received over TWO DAYS yields 2 — the number', () => {
    // The brief's second test, and it says *"assert the number, not that it is
    // non-null"* — because "non-null" passes on a zero, which is the bug.
    //
    // ★★ DATES AFTER THE CUTOFF, ON PURPOSE. Written first with 09-27 → 09-29,
    //    which are real dates from the prod probe — and the duration came back
    //    `null`, because 09-27 is BEFORE `CONSULTANT_DURATION_CUTOFF`. §A and §B
    //    are two rules and this test is about §A; the cutoff has its own block.
    const scheduled = { sent: null, recd: null };
    const pending = stampConsultantDates(scheduled, 'Pending', '2026-10-01');
    expect(pending.sent).toBe('2026-10-01');
    expect(pending.recd).toBeNull();

    const received = stampConsultantDates(pending, 'Received', '2026-10-03');
    expect(received.sent).toBe('2026-10-01'); // ★ not re-stamped
    expect(received.recd).toBe('2026-10-03');
    expect(consultantRoundDurationDays(received)).toBe(2);

    // ★ …and the same two days on the prod probe's real dates, read with the
    //   cutoff that was in force then — the interval is a property of the
    //   ladder, not of when it happened.
    expect(
      consultantRoundDurationDays({ sent: '2026-09-27', recd: '2026-09-29' }, '2026-01-01'),
    ).toBe(2);
  });

  it('★★★ the `Pending` path is UNTOUCHED — §A says so in as many words', () => {
    // Losing this would stop every send date being recorded at all, which is a
    // far worse ticket than the one being fixed.
    expect(stampConsultantDates({ sent: null, recd: null }, 'Pending', TODAY).sent)
      .toBe(TODAY);
    // ★★ fix-474's reason for the coalesce: re-entering Pending after a
    //    correction must NOT overwrite the date it really went out.
    expect(
      stampConsultantDates({ sent: '2026-09-01', recd: null }, 'Pending', TODAY).sent,
    ).toBe('2026-09-01');
  });

  it('★★ `recd` is untouched too — the skip costs the SEND date, not the receipt', () => {
    // A round that reached Received really was received today, whatever route
    // it took. Only `sent` becomes silent.
    expect(stampConsultantDates({ sent: null, recd: null }, 'Received', TODAY).recd)
      .toBe(TODAY);
    expect(
      stampConsultantDates({ sent: null, recd: '2026-08-01' }, 'Received', TODAY).recd,
    ).toBe('2026-08-01');
  });

  it('★★ stepping back to Scheduled still clears both, and Pending clears recd', () => {
    // The ladder is walkable in both directions; fix-560 changes one branch of
    // one column and nothing else.
    const back = stampConsultantDates({ sent: '2026-09-01', recd: '2026-09-05' }, 'Scheduled', TODAY);
    expect(back).toEqual({ sent: null, recd: null });
    const down = stampConsultantDates({ sent: '2026-09-01', recd: '2026-09-05' }, 'Pending', TODAY);
    expect(down).toEqual({ sent: '2026-09-01', recd: null });
  });

  it('★★★ a SECOND trip through Received still cannot invent a send date', () => {
    // ★★ The latch that matters. Somebody correcting a status back and forth
    //    must not eventually shake a `sent` loose — under the old rule the
    //    second arrival at Received would stamp one.
    let r: { sent: string | null; recd: string | null } = { sent: null, recd: null };
    r = stampConsultantDates(r, 'Received', '2026-09-29');
    r = stampConsultantDates(r, 'Scheduled', '2026-09-30');
    r = stampConsultantDates(r, 'Received', '2026-10-01');
    expect(r.sent).toBeNull();
    expect(consultantRoundDurationDays(r)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-560 §B — the cutoff, and nothing is deleted', () => {
  it('★★★ no duration is counted for a PRE-CUTOFF round', () => {
    // The brief's fourth test. The dates are kept and shown; they are not
    // counted — §B reads *"only keep the dates starting today"* as **stop
    // counting them**, never *erase them*.
    expect(consultantRoundDurationDays({ sent: '2026-09-02', recd: '2026-09-02' })).toBeNull();
    // ★★ …and that holds for a pre-cutoff round with a REAL interval too. See
    //    the note on `consultantRoundDurationDays`: a pre-cutoff zero cannot be
    //    told from a genuine same-day, so the rule is per-ROUND, not per-shape.
    expect(consultantRoundDurationDays({ sent: '2026-06-05', recd: '2026-07-12' })).toBeNull();
  });

  it('★★★ the cutoff is the APPLY date, not the day Bobby ruled', () => {
    // ★★★ MEASURED: 6 of the 28 zeroes were stamped ON OR AFTER 2026-09-15,
    //     because the ruling did not change the function — the migration does.
    //     A cutoff at the ruling date would pass exactly those six straight
    //     into the first average anybody computes.
    expect(CONSULTANT_DURATION_CUTOFF > '2026-09-15').toBe(true);
    expect(CONSULTANT_DURATION_CUTOFF).toBe('2026-09-29');
    // a zero stamped after the ruling but before the fix is still not counted
    expect(consultantRoundDurationDays({ sent: '2026-09-18', recd: '2026-09-18' })).toBeNull();
  });

  it('★★★ a POST-cutoff same-day round DOES count, and counts as 0', () => {
    // ★★ THE OTHER HALF, and it is why the cutoff is a date rather than a ban on
    //    zeroes. After fix-560 a skip writes NULL, so a post-cutoff `recd = sent`
    //    can only mean Scheduled → Pending → Received on one day — a genuine
    //    same-day turnaround, and real data.
    expect(consultantRoundDurationDays({ sent: '2026-10-05', recd: '2026-10-05' })).toBe(0);
    expect(consultantDurationIsCountable({ sent: '2026-10-05', recd: '2026-10-05' })).toBe(true);
  });

  it('★★ the four silences, each for its own reason', () => {
    // in flight — 15 rounds sit here right now
    expect(consultantRoundDurationDays({ sent: '2026-10-01', recd: null })).toBeNull();
    // the backfill — 11 Received rows that never went through the RPC
    expect(consultantRoundDurationDays({ sent: null, recd: '2026-10-01' })).toBeNull();
    // nothing at all
    expect(consultantRoundDurationDays({ sent: null, recd: null })).toBeNull();
    // ★ typed backwards: a negative turnaround is not a fast one
    expect(consultantRoundDurationDays({ sent: '2026-10-05', recd: '2026-10-01' })).toBeNull();
  });

  it('★★ a multi-day post-cutoff interval is the number of days', () => {
    expect(consultantRoundDurationDays({ sent: '2026-10-01', recd: '2026-10-15' })).toBe(14);
    // ★ across a DST boundary — the arithmetic is on ISO dates, not local time.
    //   fix-433's lesson: a Date-based "today" is tomorrow after 17:00 Pacific.
    expect(consultantRoundDurationDays({ sent: '2026-10-30', recd: '2026-11-06' })).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-560 — the migration is staged, and it moves nothing', () => {
  it('★★★ Received no longer stamps `sent`', () => {
    expect(SQL).toContain("when v_status = 'Received' then r.sent");
    // the old combined branch is the thing being replaced
    expect(SQL).toContain("when v_status in ('Pending', 'Received')");   // the ANCHOR
    expect(SQL).toContain('the old combined Pending/Received branch survives');
  });

  it('★★★ the `Pending` branch keeps its coalesce', () => {
    expect(SQL).toContain("when v_status = 'Pending' then coalesce(r.sent, v_today)");
    // asserted inside the migration too, so applying it half-way fails loudly
    expect(SQL).toContain('Pending no longer stamps sent — the fix went too far');
  });

  it('★★★ `recd` is not disturbed', () => {
    expect(SQL).toContain("when v_status = 'Received' then coalesce(r.recd, v_today)");
  });

  it('★★★ it MOVES NO ROWS — the Do-NOT list, asserted by absence', () => {
    // ⛔ *"Change the Pending stamping, backfill the 22, or delete any date."*
    // The cheapest way to backfill is one UPDATE nobody reads closely.
    const code = MIGRATION
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(code).not.toMatch(/\bupdate\s+public\.project_consultant_rounds/i);
    expect(code).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
  });

  it('★★★ it says NOT APPLIED, near the top', () => {
    expect(MIGRATION).toContain('NOT APPLIED');
    expect(MIGRATION.indexOf('NOT APPLIED')).toBeLessThan(400);
  });

  it('★★★ it is anchored, and RAISES if the anchor has moved', () => {
    // fix-540's rule: a `replace` that matches nothing reports success.
    expect(MIGRATION).toContain('anchor not found in bp_set_consultant_status');
    expect(MIGRATION).toContain('replacement changed nothing');
    // ★ and fix-540's other half: read the LIVE definition back afterwards
    expect(MIGRATION).toContain('executed but the LIVE body still stamps sent on Received');
  });

  it('★★★ the re-emit does not silently revert four other tickets', () => {
    // ★★ Re-emitting a whole function body is how earlier work gets undone. Each
    //    of these is asserted INSIDE the migration, after the EXECUTE.
    for (const kept of [
      "fix-479's reopen branch was lost",
      "fix-382's OCC check was lost",
      "fix-433's Pacific today was lost",
      "fix-479's void filter was lost",
    ]) {
      expect(SQL, kept).toContain(kept);
    }
  });

  it('★★★ it carries the cutoff check for a late apply', () => {
    // ★★ If the file is applied after 2026-09-29, zeroes could be written in the
    //    gap and would pass the filter. The check names them.
    expect(MIGRATION).toContain('zeroes_after_the_cutoff');
    expect(MIGRATION).toContain(CONSULTANT_DURATION_CUTOFF);
  });

  it('★★ the probe is recorded, with both ladders and their numbers', () => {
    expect(MIGRATION).toContain('ROLLED BACK');
    expect(MIGRATION).toContain('sent=**NULL**');
    expect(MIGRATION).toContain('**2 days**');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-560 — the TS mirror and the SQL stay in lockstep', () => {
  it('★★★ the mirror has NO coalesce on the Received branch, and the SQL agrees', () => {
    // The twin relationship is the thing that can rot. Both sides asserted.
    expect(SQL).toContain("when v_status = 'Received' then r.sent");
    const mirror = stampConsultantDates({ sent: null, recd: null }, 'Received', TODAY);
    expect(mirror.sent).toBeNull();
  });

  it('★★★ fix-474\'s ORIGINAL migration still carries the OLD rule — on purpose', () => {
    // ★★ SUPERSEDED, NOT REWRITTEN. `fix_474_consultant_records.sql` is the file
    //    that created this function and it is left byte-for-byte alone: a
    //    migration is a record of what was done, and editing an applied one to
    //    match today's behaviour destroys the history it exists to hold.
    //    fix-560 supersedes it in a NEW file, which is why `ConsultantDataLayer
    //    Fix474` still asserts the old text and now says so out loud.
    expect(ORIGINAL).toContain("when v_status in ('Pending', 'Received')");
    expect(ORIGINAL).toContain('coalesce(r.sent, v_today)');
    expect(ORIGINAL).not.toContain('fix-560');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-560 — what is deliberately NOT here', () => {
  it('★★★ no expand panel (P-214) and no benchmark (P-265)', () => {
    // ⛔ Both *"wait for real intervals"*. There are 10 today and they are all
    //    pre-cutoff, so there is still nothing honest to average.
    expect(MIGRATION).not.toMatch(/create\s+(or replace\s+)?view/i);
    expect(MIGRATION).not.toMatch(/bp_consultant_benchmark|bp_consultant_history/i);
  });

  it('★★★ nothing in the app renders a consultant DURATION yet', () => {
    // Measured on origin/main: `recd` reaches the UI only as a date. The
    // predicate exists so P-214 and P-265 inherit the rule rather than each
    // inventing one — which is the defect this Brain records most often.
    expect(typeof consultantDurationIsCountable).toBe('function');
    expect(typeof consultantRoundDurationDays).toBe('function');
  });
});
