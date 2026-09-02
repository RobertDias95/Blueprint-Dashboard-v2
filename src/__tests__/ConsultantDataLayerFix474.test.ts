import { describe, it, expect } from 'vitest';
import MIGRATION from '../../migrations/fix_474_consultant_records.sql?raw';
import {
  CONSULTANT_DATE_FIELDS,
  CONSULTANT_DATE_SLOTS,
  CONSULTANT_STATUSES,
  CONSULTANT_STATUS_DEFAULT,
  LEAD_BUSINESS_DAYS,
  currentRound,
  seedConsultantDates,
  seedPhaseLabel,
  transitionAppends,
  type ConsultantRound,
  type ConsultantStatus,
} from '../lib/consultants';
import { minusBusinessDays, nextBusinessDay } from '../lib/boardAging';

// ===========================================================================
// ★★★ fix-474 (P-116) — THE CONSULTANT RECORD AND ITS ROUNDS · DATA LAYER
// ===========================================================================
//
// Bobby: *"the overall goal here is to help get more clarity for our
// acquisitions team… what it doesn't show is consultants. Are the consultants
// complete? Are we waiting on consultants? What's the status?"*
//
// ★★ NO UI IN THIS TICKET. fix-475 builds the column on top.
//
// ---------------------------------------------------------------------------
// ★★★ MEASURED ON PROD 2026-09-01, BEFORE ANYTHING WAS WRITTEN
// ---------------------------------------------------------------------------
//   projects 202 · with external_team 53 · firm pairs inside them 159
//   external_team_directory 16 rows, 7 disciplines
//   permit_tasks.waiting_on 111 rows, 28 OPEN (the brief said "~30")
//
//   ★★★ AND THE NUMBER THAT DECIDED THE FOREIGN KEY: all **159** free-text
//   firm names resolve to a directory row on (name, discipline). **ZERO
//   unmatched.** Making the firm a REFERENCE orphans nothing, so P-100
//   (consultant firms are free text) closes here rather than being deferred.
//
// ---------------------------------------------------------------------------
// ★★★ THE SQL WAS PROVED AGAINST PRODUCTION, ROLLED BACK
// ---------------------------------------------------------------------------
// There is no live database in CI (fix-153), so the SQL half of this file is a
// text mirror. The behaviour it mirrors was exercised for real inside a
// transaction ending in ROLLBACK — the whole schema created, then driven:
//
//   1  add                     → rounds=1 status=Scheduled phase=Design
//                                est_send/est_recd seeded, sent/recd NULL
//   2  → Pending               → sent stamped, recd NULL
//   3  → Received              → recd stamped, rounds still 1
//   4  Received → Scheduled    → rounds=2, index=1, phase 'Cycle 1',
//                                **round 0 BYTE-IDENTICAL** (updated_at too)
//   5  Pending → Scheduled     → in place, sent cleared, rounds still 2
//   6  Received → Pending      → in place, recd cleared
//   7  a 2nd discipline        → independent round lists (2 vs 1)
//   8  firm set inactive       → still resolves (firm=SSS active=f)
//   9  PROPERTY                → round 0 updated_at = created_at, untouched
//  10  stale OCC token         → conflict=t, appended=f, status unchanged
//  11  status 'Complete'       → SQLSTATE 22023
//  12  wrong-discipline firm   → SQLSTATE 23503
//  13  DELETE a used firm      → SQLSTATE 23503 (ON DELETE RESTRICT)

// ---------------------------------------------------------------------------
// §1 — the status ladder, in all three places
// ---------------------------------------------------------------------------
describe('fix-474 §1 — the status vocabulary', () => {
  it('★★★ Scheduled → Pending → Received, and the default is Scheduled', () => {
    // ★★ It has changed THREE times (Preparing/Sent/Complete → Preparing/In
    //    progress/Complete → these). Nothing may hard-code one at a call site.
    expect(CONSULTANT_STATUSES).toEqual(['Scheduled', 'Pending', 'Received']);
    expect(CONSULTANT_STATUS_DEFAULT).toBe('Scheduled');
  });

  it('★★★ THE THREE PLACES AGREE — fix-464\'s trap, pre-empted', () => {
    // ★★★ fix-464 found that `bp_set_team_department` validated against its
    //     OWN private list, so widening the CHECK constraint alone shipped a
    //     picker whose options the writer rejected — a failure at the LAST
    //     step of the change. The same three-place shape exists here, so it is
    //     asserted before it can bite:
    //       1. CONSULTANT_STATUSES (above)
    //       2. the CHECK on project_consultant_rounds.status
    //       3. bp_set_consultant_status's own `not in (...)`
    const quoted = CONSULTANT_STATUSES.map((s) => `'${s}'`).join(', ');
    expect(MIGRATION).toContain(`check (status in (${quoted}))`);
    expect(MIGRATION).toContain(`if v_status not in (${quoted}) then`);
    // ★ …and no retired word survives anywhere in the schema.
    for (const dead of ['Preparing', 'In progress', 'Complete', 'Sent to']) {
      expect(MIGRATION).not.toContain(`'${dead}'`);
    }
  });

  it('★★ each status shows exactly two of the four date slots', () => {
    expect(CONSULTANT_DATE_SLOTS.Scheduled).toEqual(['est_send', 'est_recd']);
    expect(CONSULTANT_DATE_SLOTS.Pending).toEqual(['sent', 'est_recd']);
    expect(CONSULTANT_DATE_SLOTS.Received).toEqual(['sent', 'recd']);
    // ★ The RECORD keeps all four whatever is shown — that is what makes
    //   stepping backwards non-destructive.
    expect(CONSULTANT_DATE_FIELDS).toHaveLength(4);
    for (const s of CONSULTANT_STATUSES) {
      for (const f of CONSULTANT_DATE_SLOTS[s]) {
        expect(CONSULTANT_DATE_FIELDS).toContain(f);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — the seeds
// ---------------------------------------------------------------------------
describe('fix-474 §2 — the two EST dates seed, and assert nothing', () => {
  it('★★★ EST RECEIVED = Target Submit − 3 BUSINESS days, one constant', () => {
    expect(LEAD_BUSINESS_DAYS).toBe(3);
    // 2026-10-07 is a Wednesday → back three business days is Friday 10-02.
    expect(seedConsultantDates({ ddEnd: null, targetSubmit: '2026-10-07' }).est_recd)
      .toBe('2026-10-02');
    // ★★ AND THE WEEKEND IS WHY IT IS BUSINESS DAYS. 2026-10-06 is a Tuesday;
    //    three CALENDAR days back is Saturday 10-03, which is not a day anyone
    //    receives anything. Three business days is Thursday 10-01.
    expect(seedConsultantDates({ ddEnd: null, targetSubmit: '2026-10-06' }).est_recd)
      .toBe('2026-10-01');
  });

  it('★★ EST SEND comes from vendorTargetSend — one concept, one function', () => {
    // ★★★ NOT RE-DERIVED. `vendorTargetSend`'s own comment is the warning:
    //     "the second literal `- 7` here is exactly how the row on this card
    //     and the date in the email would silently diverge the day the lead
    //     changes." So this composes it rather than repeating dd_end − 7.
    expect(seedConsultantDates({ ddEnd: '2026-10-30', targetSubmit: null }).est_send)
      .toBe('2026-10-23');
    // ★ Its documented end_week fallback still applies, unchanged.
    expect(
      seedConsultantDates({ ddEnd: null, endWeek: '2026-10-30', targetSubmit: null })
        .est_send,
    ).toBe('2026-10-23');
  });

  it('★★ a missing anchor seeds NULL, not a guess', () => {
    // A project with no DD window has no EST SEND — exactly as fix-311's
    // Consultant row renders nothing rather than inventing a date.
    expect(seedConsultantDates({ ddEnd: null, targetSubmit: null })).toEqual({
      est_send: null,
      est_recd: null,
    });
  });

  it('★ minusBusinessDays is the mirror of nextBusinessDay, and skips weekends', () => {
    // Both live in boardAging so "not a working day" has ONE definition.
    expect(minusBusinessDays('2026-10-05', 1)).toBe('2026-10-02'); // Mon → Fri
    expect(minusBusinessDays('2026-10-05', 0)).toBe('2026-10-05'); // no-op
    expect(nextBusinessDay('2026-10-02')).toBe('2026-10-05'); // Fri → Mon
    // Five business days back from a Monday is the Monday before.
    expect(minusBusinessDays('2026-10-05', 5)).toBe('2026-09-28');
  });
});

// ---------------------------------------------------------------------------
// §3 — rounds
// ---------------------------------------------------------------------------
function round(over: Partial<ConsultantRound> & { id: string }): ConsultantRound {
  return {
    consultant_id: 'c-1',
    round_index: 0,
    phase: 'Design',
    status: 'Scheduled',
    est_send: null,
    sent: null,
    est_recd: null,
    recd: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

describe('fix-474 §3 — current is the latest round', () => {
  it('★★ highest round_index wins, whatever the order in the array', () => {
    const cur = currentRound([
      round({ id: 'a', round_index: 0 }),
      round({ id: 'b', round_index: 2 }),
      round({ id: 'c', round_index: 1 }),
    ]);
    expect(cur?.id).toBe('b');
  });

  it('★★★ the tie-break is `id`, and fix-338 is why it exists at all', () => {
    // ★★ `now()` is CONSTANT inside a transaction, so two rounds written
    //    together carry identical timestamps and a timestamp sort would order
    //    them at random. The SQL view sorts by (round_index desc, id desc) —
    //    the SAME two keys — so the client and the database cannot disagree
    //    about which round is current.
    const cur = currentRound([
      round({ id: 'aaa', round_index: 1 }),
      round({ id: 'zzz', round_index: 1 }),
    ]);
    expect(cur?.id).toBe('zzz');
    expect(MIGRATION).toContain('order by r2.round_index desc, r2.id desc');
    expect(MIGRATION).toContain('order by r.round_index desc, r.id desc');
  });

  it('★ no rounds is null, not a throw', () => {
    expect(currentRound([])).toBeNull();
  });

  it('★★★ ONLY Received → Scheduled appends; everything else edits in place', () => {
    const all: ConsultantStatus[] = ['Scheduled', 'Pending', 'Received'];
    const appending: string[] = [];
    for (const from of all) {
      for (const to of all) {
        if (transitionAppends(from, to)) appending.push(`${from}->${to}`);
      }
    }
    // Exactly one of the nine transitions creates history.
    expect(appending).toEqual(['Received->Scheduled']);
    // ★ A brand-new consultant (no prior status) never appends either.
    expect(transitionAppends(null, 'Scheduled')).toBe(false);
  });

  it('★★ the round label seeds from the counter and is free text after that', () => {
    expect(seedPhaseLabel(0)).toBe('Design');
    expect(seedPhaseLabel(1)).toBe('Cycle 1');
    expect(seedPhaseLabel(2)).toBe('Cycle 2');
    // ★★ NOT A REGISTRY, deliberately: Bobby wants "Cycle 1 & 2" typeable
    //    *"in case multiple cycles handle in one round"*. It is a caption on a
    //    row the user owns and IT IS NOT A JOIN KEY — which is the whole
    //    difference between this free text and the firm name P-100 is about.
    expect(MIGRATION).toContain('phase          text not null');
    expect(MIGRATION).not.toMatch(/check \(phase in \(/);
  });
});

// ---------------------------------------------------------------------------
// §4 — the schema's own rules, mirrored from the migration text
// ---------------------------------------------------------------------------
describe('fix-474 §4 — what the database guarantees', () => {
  it('★★★ TWO TABLES: rounds are ROWS, because history must not be rewritten', () => {
    // ★★ A JSONB array is rewritten whole on every change, so "nothing is ever
    //    overwritten" would be a property of the code rather than of the
    //    storage — and fix-402 is this repo's own scar from exactly that:
    //    `parseUnitTypes` is a WHITELIST and both editors write the array back,
    //    so an unrecognised key is DELETED on the next save.
    // ★ And the precedent the ruling names — "mirrors correction rounds" —
    //   is `permit_cycles`, which are rows ordered by an index.
    expect(MIGRATION).toContain('create table if not exists public.project_consultants');
    expect(MIGRATION).toContain('create table if not exists public.project_consultant_rounds');
    expect(MIGRATION).toContain('round_index    integer not null');
    expect(MIGRATION).not.toMatch(/rounds\s+jsonb/);
  });

  it('★★★ THE FIRM IS A REFERENCE — this is where P-100 closes', () => {
    expect(MIGRATION).toContain(
      'firm_id     uuid not null references public.external_team_directory(id)',
    );
    // ★★ ON DELETE RESTRICT, and it is the answer to "handle a directory row
    //    going inactive without orphaning a consultant":
    //      · INACTIVE is a flag, not a delete — the FK still resolves, so an
    //        old engagement keeps naming its firm for ever. No code needed.
    //      · DELETION is refused while a consultant points at the row. SET NULL
    //        would silently forget who did the work; CASCADE would delete the
    //        record. RESTRICT makes the admin deactivate instead.
    expect(MIGRATION).toContain('on delete restrict');
    expect(MIGRATION).not.toMatch(/external_team_directory\(id\)[\s\S]{0,80}on delete set null/);
  });

  it('★★ one consultant per (project, discipline) — the unit IS the discipline', () => {
    expect(MIGRATION).toContain('unique (project_id, discipline)');
    // A second engagement with the same firm is a ROUND, not a second record.
    expect(MIGRATION).toContain('unique (consultant_id, round_index)');
  });

  it('★★★ NO PERMISSION TIER, and that is the ruling', () => {
    // Bobby, 2026-09-01: anyone who can edit may reopen. He named four people
    // who are NOT on a given project's team precisely because they cover for
    // each other, and the app has no read-only tier (`profiles_role_check`
    // allows only admin|editor). So these take project_holds' shape — tenant
    // members, all verbs — NOT external_team_directory's admin-only writes.
    expect(MIGRATION).toContain('using (tenant_id = any (public.auth_tenant_ids()))');
    expect(MIGRATION).not.toContain('is_tenant_admin');
  });

  it('★★★ the view is security_invoker — the standing house rule', () => {
    // Without it the view runs as its OWNER and quietly bypasses the RLS
    // above, which is how a tenant boundary leaks. Standing rule since the
    // TRUNCATE-grant incident (fix-273 / fix-455).
    expect(MIGRATION).toContain('with (security_invoker = true)');
    // ★ …and the grant posture: anon never, authenticated then filtered by RLS.
    expect(MIGRATION).toContain('revoke all on public.project_consultants       from public, anon;');
    expect(MIGRATION).not.toMatch(/grant[^;]*truncate/i);
  });

  it('★★★ THE AUTO-STAMP IS THE SERVER\'S, and only fills an EMPTY slot', () => {
    // Bobby: *"okay, here's the status, auto date pops in."* Nobody types
    // `sent` or `recd`.
    expect(MIGRATION).toContain("when v_status in ('Pending', 'Received')");
    // ★★ `coalesce(r.sent, v_today)` — re-entering Pending after a correction
    //    must NOT overwrite the date it really went.
    expect(MIGRATION).toContain('coalesce(r.sent, v_today)');
    expect(MIGRATION).toContain('coalesce(r.recd, v_today)');
    // ★ Pacific, not UTC — fix-433's rule: a UTC "today" goes silent on
    //   exactly the day it must speak (20:11 PT is already tomorrow in UTC).
    expect(MIGRATION).toContain("now() at time zone 'America/Los_Angeles'");
  });

  it('★★★ PROPERTY: no write path names a round other than the latest', () => {
    // §6's property, expressed where it can be enforced. Every UPDATE in the
    // status/date/phase RPCs targets `v_cur.id`, which is selected as the
    // highest round_index — so an older round is never named by any statement.
    const updates = MIGRATION.match(/update public\.project_consultant_rounds[\s\S]*?where [^\n]*\n/g) ?? [];
    expect(updates.length).toBeGreaterThanOrEqual(3);
    for (const u of updates) {
      expect(u).toContain('where r.id = v_cur.id');
    }
    // ★ And the reopen branch inserts — it does not touch the finished round
    //   at all, which the prod probe confirmed byte-for-byte including
    //   `updated_at`.
    expect(MIGRATION).toContain("if v_cur.status = 'Received' and v_status = 'Scheduled' then");
  });

  it('★★ OCC is checked BEFORE anything writes — fix-382\'s rule', () => {
    // ★★★ Doing it as a WHERE clause on the UPDATE works for the in-place
    //     branch and SILENTLY SKIPS the check on the APPEND branch — the half
    //     that creates history. So the comparison is an explicit early return
    //     above both branches.
    const status = MIGRATION.slice(MIGRATION.indexOf('bp_set_consultant_status'));
    const occAt = status.indexOf('v_cur.updated_at is distinct from p_expected_updated_at');
    const appendAt = status.indexOf("if v_cur.status = 'Received'");
    const updateAt = status.indexOf('update public.project_consultant_rounds');
    expect(occAt).toBeGreaterThan(-1);
    expect(occAt).toBeLessThan(appendAt);
    expect(occAt).toBeLessThan(updateAt);
  });

  it('★★ every write RPC returns its new token — fix-073 / fix-442 / fix-443', () => {
    // An RPC that returns `updated_at` is only half the fix; the caller must
    // hand it back. Both halves are asserted — here, and in the hook file.
    for (const fn of [
      'bp_add_project_consultant',
      'bp_set_consultant_status',
      'bp_set_consultant_date',
      'bp_set_consultant_phase',
      'bp_set_consultant_firm',
    ]) {
      expect(MIGRATION).toContain(`create or replace function public.${fn}`);
    }
    const returns = MIGRATION.match(/returns table\([^)]*\)/g) ?? [];
    expect(returns.length).toBe(5);
    for (const r of returns) expect(r).toContain('updated_at timestamptz');
  });
});

// ---------------------------------------------------------------------------
// §5 — RETIRED BY fix-479 §E (P-132), 2026-09-02: THE SEED WAS APPROVED
// ---------------------------------------------------------------------------
// ★★★ THESE FOUR TESTS EXISTED TO KEEP A FILE FROM RUNNING. fix-474 shipped
// `fix_474_seed_from_external_team_PENDING_APPROVAL.sql` as a readable proposal
// with every statement commented out, because the 2026-09-01 ruling was *"the
// tracker starts empty and fills from new activity"* and Bobby had not been
// asked. They asserted: nothing uncommented, the real prod counts in the
// header, that a seeded record claims no history, and that the FILENAME still
// said PENDING_APPROVAL.
//
// ★★★ BOBBY WAS ASKED, WITH THE COST STATED, AND SAID YES — 2026-09-02: *"if
// there is an external member there, let's make sure we add it over to
// consultants… the status default for all the projects would be whatever the
// primary setting is, which I think is scheduled."* The file is now
// `migrations/fix_479_seed_from_external_team.sql`, it is APPLIED, and it
// created 164 records and 164 rounds on prod.
//
// ★★ SO THE ASSERTIONS ARE NOT DROPPED, THEY ARE INVERTED. "Nothing runs" was
// only ever the right test while the answer was unknown; the right test now is
// what the seed actually did, and that lives in
// ConsultantVoidAndSeedFix479.test.ts — including the resolve gate that fired
// on one unmatched pair, and the header claim that the void migration was
// applied FIRST so no seeded row was ever reachable by a `delete`.
//
// ★ §1–§4 above are untouched: they are about the fix-474 SCHEMA, which is
//   still what the app runs on.
