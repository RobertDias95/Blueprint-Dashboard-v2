import type { PermitWithCycles, Project } from './database.types';
import { todayIso } from './dateUtils';

// ===========================================================================
// ★★★ fix-508 §D (P-194) — TARGET APPROVAL, AND WHAT "ACCEPTED" MEANS
// ===========================================================================
//
// Bobby's ruling, 2026-09-09:
//
//   **Target Approval = the LATEST of ( ACQ date · Closing date · GO date + 6
//   calendar months ).** Computed. Show nothing about which date drove it on
//   the Project Overview; Project Details names the driver.
//
// ---------------------------------------------------------------------------
// ★★★ "ACQ DATE" IS `permits.expected_issue`, AND THAT NEEDED ESTABLISHING
// ---------------------------------------------------------------------------
//
// There is no column called an ACQ date. I checked every column on `projects`
// and `permits` matching acq / clos / go_ / target / expected, and the set is:
// `expected_issue`, `target_submit`, `acq_lead` (a person), `closing_date`,
// `go_date`.
//
// ★★ `expected_issue` IS THE ONE, on three pieces of evidence rather than one:
//    it is what the overview has labelled **`ACQ target`** since fix-506; it is
//    team-owned and the scraper never writes it (`ScheduleHealthTable`'s own
//    header comment says so); and fix-63 made it inline-editable precisely so
//    Acquisitions could retarget without opening Project Settings. It is the
//    date ACQ types. **No migration.**
//
// ★★★ AND ITS ROLE INVERTS, WHICH IS THE WHOLE OF §D. It used to BE the answer
//     — the overview printed it as `ACQ target` and Schedule Health measured
//     drift against it. Now it is one of three CANDIDATES and the answer is a
//     `max`. A date the team types can no longer pull the target EARLIER than
//     the closing or than six months after GO; it can only push it later.
//
// ★★★ SO THE INLINE EDIT ON SCHEDULE HEALTH HAD TO MOVE, and this is the
//     [[P-179-pipeline-stage-and-draw-schedule-disagree]] rule applied before
//     it bites rather than after: two surfaces writing one number by different
//     rules is the defect. Schedule Health's column 7 renders the DERIVED
//     Target Approval and is read-only — so the blue that was its editable
//     affordance goes with it — and the input lives in Project Data as the ACQ
//     date. One place writes it; every place derives from it.

/** How far past the GO date the third candidate sits. ★ CALENDAR months, not
 *  180 days — Bobby said months and the two differ by up to three days. */
export const TARGET_APPROVAL_GO_MONTHS = 6;

/** Which of the three candidates produced the answer. */
export type TargetApprovalDriver = 'acq' | 'closing' | 'go';

export interface TargetApproval {
  /** The date, ISO `YYYY-MM-DD`, or null when none of the three is recorded. */
  date: string | null;
  /** Which candidate won. ★ Null only when `date` is null. */
  driver: TargetApprovalDriver | null;
  /** Every candidate that was available, for Project Details' note. */
  candidates: { driver: TargetApprovalDriver; date: string; label: string }[];
}

/** What Project Details calls each driver. ★ One list, so the note and any
 *  future surface cannot name the same date two ways. */
export const TARGET_APPROVAL_DRIVER_LABEL: Record<TargetApprovalDriver, string> = {
  acq: 'the ACQ date',
  closing: 'the closing date',
  go: `the GO date plus ${TARGET_APPROVAL_GO_MONTHS} months`,
};

/**
 * ★★★ SIX CALENDAR MONTHS, AND THE END-OF-MONTH CASE IS DECIDED HERE.
 *
 * `2026-08-31` plus six months has no 31st to land on. JavaScript's `Date`
 * rolls it forward into March; we clamp to the last day of February instead,
 * because a target that jumps a month on the 31st and not on the 30th is a rule
 * nobody can hold in their head.
 *
 * ★ Parsed as UTC parts, never `new Date(str)` — a bare `YYYY-MM-DD` is parsed
 *   as UTC but `new Date(y, m, d)` is local, and mixing the two is how a date
 *   moves a day for anybody west of Greenwich. fix-433's rule.
 */
export function addCalendarMonths(iso: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const targetMonth0 = mo - 1 + months;
  const ny = y + Math.floor(targetMonth0 / 12);
  const nm0 = ((targetMonth0 % 12) + 12) % 12;
  // ★ Day 0 of the NEXT month is the last day of this one — the clamp.
  const lastDay = new Date(Date.UTC(ny, nm0 + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ny}-${pad(nm0 + 1)}-${pad(nd)}`;
}

/**
 * The project's Target Approval.
 *
 * ★ `null` when none of the three dates is recorded — which is a real state
 *   (a project created this morning) and must print as an em dash rather than
 *   as today's date or an epoch.
 */
export function targetApproval(
  project: Pick<Project, 'closing_date' | 'go_date'> | null | undefined,
  bp: Pick<PermitWithCycles, 'expected_issue'> | null | undefined,
): TargetApproval {
  const candidates: TargetApproval['candidates'] = [];
  const acq = bp?.expected_issue ?? null;
  if (acq) candidates.push({ driver: 'acq', date: acq, label: TARGET_APPROVAL_DRIVER_LABEL.acq });
  const closing = project?.closing_date ?? null;
  if (closing) {
    candidates.push({
      driver: 'closing',
      date: closing,
      label: TARGET_APPROVAL_DRIVER_LABEL.closing,
    });
  }
  const go = project?.go_date ? addCalendarMonths(project.go_date, TARGET_APPROVAL_GO_MONTHS) : null;
  if (go) candidates.push({ driver: 'go', date: go, label: TARGET_APPROVAL_DRIVER_LABEL.go });

  if (candidates.length === 0) return { date: null, driver: null, candidates };
  // ★ ISO dates sort lexicographically, so `max` is a string comparison — no
  //   Date objects, no timezone to get wrong.
  let best = candidates[0];
  for (const c of candidates) if (c.date > best.date) best = c;
  return { date: best.date, driver: best.driver, candidates };
}

// ===========================================================================
// ★★★ §D — "ACCEPTED", DEFINED ONCE
// ===========================================================================
//
// The brief: *define "accepted" once, in one helper, and say where it lives.*
// [[P-182-agenda-keeps-intakes-that-have-already-been-accepted]] and
// [[P-180-seattle-intakes-need-a-72-business-hour-warning]] both need this same
// predicate next, and a second copy of it is how the agenda and the overview
// end up disagreeing about whether a permit is through intake.
//
// ★★★ IT IS `permits.intake_date`, AND fix-506 ALREADY MEASURED WHY. The other
//     candidate is cycle 0's `intake_accepted`: of 229 building permits on
//     prod, **193 carry `intake_date` and 190 carry the cycle value, they
//     disagree on 3, and exactly ONE permit has the cycle value without the
//     permit one.** So `intake_date` is the better-covered of the two, and
//     fix-506 §B already switched the overview's `Accepted` row to it. This
//     names that choice rather than making a new one.

// ===========================================================================
// ★★★ fix-513 §A (P-208) — A DATE IS NOT A STATE
// ===========================================================================
//
// fix-508 shipped `return !!permit?.intake_date;` and the sentence above it was
// already the bug: **`intake_date` is not "the date intake was accepted".** It
// is *the intake date, whenever it falls* — the scraper and the DAs both write
// SCHEDULED intakes into it, months ahead. A column holding a future
// appointment was being read as a past event.
//
// **RULED BY BOBBY, 2026-09-09: DATE ONLY.** Accepted means the intake date has
// arrived. Status does **not** corroborate it, on the argument that status
// vocabulary is jurisdiction-specific and drifts while the date is a fact.
//
// ★★★ AND THE RULING WAS TAKEN AGAINST A MEASURED COUNTEREXAMPLE SET, not in
//     ignorance of one. **19 prod permits** carry a PAST `intake_date` beside a
//     status that says intake has not happened (14 × `Pre-Submittal — GO`,
//     3 × `Pre-Submittal — Kickoff`, 2 × `Ready for Intake`). Under date-only
//     every one of them reads "Accepted intake". **That is a DATA problem, and
//     that is precisely why the ruling stands** — a status check here would
//     hide nineteen bad rows behind a predicate instead of correcting them.
//     The set is in the fix-513 PR as a table. Nothing was written to them.
//
// ★★★ THE VISIBLE POPULATION OF THE BUG WAS NINE, and they are the rows this
//     line moves. Of 685 prod permits, 490 carry an `intake_date` and **9 are
//     in the future**, across 5 projects, every one `status = Scheduled`:
//     `233 31st Ave E` (BP + Demo, 2027-01-26), `2601 E Galer St` (Demo,
//     2026-12-01), `4017 Corliss Ave N` (BP 2026-12-03, Demo 2026-12-10),
//     `4137 54th Ave SW` (BP + Demo, 2027-01-26), `554 N 75th St` (BP + Demo,
//     2027-02-02). All nine flip from "Accepted intake" to "Target intake".
//
// ★★ ONE CLOCK. `todayIso` comes from `lib/dateUtils` and is injectable, so this
//    predicate cannot read a different today from the surface calling it — the
//    defect §A warned about, which the codebase already had four times over
//    before this ticket (see that module's note).

/**
 * Whether the city has accepted this permit's intake.
 *
 * ★ `today` is a parameter with a live default rather than a module constant:
 *   a constant captured at import time is wrong for any session left open
 *   across midnight, and this is a comparison against a calendar day.
 */
export function intakeIsAccepted(
  permit: Pick<PermitWithCycles, 'intake_date'> | null | undefined,
  today: string = todayIso(),
): boolean {
  const d = permit?.intake_date;
  return !!d && d <= today;
}

/**
 * The intake row's label and date — `Estimated intake` until the city accepts,
 * `Accepted intake` after.
 *
 * ★★ THE SAME SHAPE AS `Est. approval → Approved`, deliberately: fix-506 built
 *    that flip and Bobby asked for this one to match it. Two rows that mean
 *    "the plan, then the fact" should not read as two different mechanisms.
 *
 * ★ `target_submit` is the estimate. It is the date the team plans to submit,
 *   which is what an intake estimate IS — the city accepts what is submitted.
 */
export function intakeDisplay(
  permit: Pick<PermitWithCycles, 'intake_date' | 'target_submit'> | null | undefined,
  today: string = todayIso(),
): { label: string; date: string | null; isActual: boolean } {
  if (intakeIsAccepted(permit, today)) {
    return { label: 'Accepted intake', date: permit?.intake_date ?? null, isActual: true };
  }
  // ★★★ fix-513 §B — `Estimated intake` → `Target intake`. Bobby, 2026-09-09:
  //     *"this should say target intake until the intake happens."*
  //
  // ★★ IT MATCHES `Target Approval` DIRECTLY ABOVE IT, and the column under it
  //    is literally called `target_submit`. Two rows that both name a target
  //    should use the same noun; "estimated" implied the app had worked it out,
  //    when in fact somebody typed it.
  //
  // ★ THE DATE ALREADY MOVED WITH THE LABEL and did not need changing here —
  //   this branch has returned `target_submit` since fix-508. What made the row
  //   show a scheduled `intake_date` under an "Accepted" label was the predicate
  //   above, not this line. §A's fix is what routes the nine future-intake
  //   permits into this branch, where `4137 54th Ave SW` reads 10/23/2026 (its
  //   target submit) instead of 01/26/2027 (its booked intake).
  return { label: 'Target intake', date: permit?.target_submit ?? null, isActual: false };
}
