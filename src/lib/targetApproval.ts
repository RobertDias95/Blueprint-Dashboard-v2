import type { PermitWithCycles, Project } from './database.types';
import { todayIso } from './dateUtils';
// ★ fix-602 §A: the SAME one-hop rule the permits already follow. §A is explicit
//   — *"the predicate already exists … do not write a second predicate."*
import { permitSourceProjectId } from './effectivePermits';

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
 * ★★★ fix-602 §A.2 — THE SAME LABELS, SAID OF THE ORIGINAL.
 *
 * On a reuse-redesign the project-level dates are the ORIGINAL's, so a note
 * reading *"the GO date plus 6 months"* would be read as the redesign's own
 * GO — which is the number the header was wrong by. The brief is explicit:
 * *"the driver note must say ‘the original's GO date plus 6 months’ so nobody
 * reads it as the redesign's."*
 *
 * ★ `acq` is NOT re-worded. The ACQ date comes from the permit, and on a
 *   reuse-redesign the permit shown IS the original's — fix-556's mirror,
 *   which the page already labels as belonging to the original. Saying
 *   "the original's ACQ date" of a row the screen already attributes would
 *   be noise; the two project-level dates are the ones with no such label.
 */
export const TARGET_APPROVAL_DRIVER_LABEL_MIRRORED: Record<TargetApprovalDriver, string> = {
  acq: TARGET_APPROVAL_DRIVER_LABEL.acq,
  closing: "the original's closing date",
  go: `the original's GO date plus ${TARGET_APPROVAL_GO_MONTHS} months`,
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
// ════════════════════════════════════════════════════════════════════════
// ★★★ fix-602 §A (P-281) — A REUSE-REDESIGN USES THE ORIGINAL'S DATES
// ════════════════════════════════════════════════════════════════════════
//
// Bobby, 2026-09-15: **mirror the original's dates.** The family rule —
// *whatever a reuse-redesign shows, it shows the original's* — applied to
// status (fix-150), the cards (fix-556) and the leads (fix-573). This is the
// fourth application of one principle, not a new idea.
//
// ★★★ AND THE TWO SURFACES ALREADY DISAGREED, which is the measured shape of
//     the bug and is narrower than the brief assumed. `ScheduleHealthTable`
//     looks its project up **by the permit's own `project_id`**
//     (`projectsById.get(permit.project_id)`), so on a reuse-redesign it
//     already resolves to the ORIGINAL and was already right. `DatesBox` is
//     handed the PAGE's project — the redesign — and was wrong. So the header
//     and the table under it printed two different Target Approvals.
//
//     `4000 SW Concord St [Redesign]`, measured 2026-09-30:
//       redesign GO 2026-06-25 + 6 → **2026-12-25**  ← what the header read
//       original GO 2026-01-22 + 6 →  2026-07-22
//       original BP ACQ           → **2026-10-09**  ← the MAX, and the answer
//
// ★★ ONE HOP, AND IT IS THE HOP THAT ALREADY EXISTS. `permitSourceProjectId`
//    is the rule "which project's rows does this one render", and the dates
//    follow the permits by the same ruling. No second predicate — §A says so
//    in as many words, and a second one is how fix-150 and fix-556 would have
//    drifted apart.

/**
 * The project whose `go_date` / `closing_date` drive this project's Target
 * Approval — itself, unless it is a reuse-redesign, in which case the
 * original.
 *
 * ★★★ IT FALLS BACK TO THE PROJECT ITSELF when the original is not in the
 *     list handed to it. A redesign whose original has not loaded must render
 *     its own dates, not a blank card — returning null here would make a
 *     loading state look like a project with no dates recorded.
 */
export function targetApprovalDateSource<
  T extends {
    id: string;
    redesign_of_project_id?: string | null;
    redesign_reuses_original_permit?: boolean | null;
  },
>(project: T | null | undefined, allProjects: readonly T[] | null | undefined): T | null {
  if (!project) return null;
  const sourceId = permitSourceProjectId(project);
  if (!sourceId || sourceId === project.id) return project;
  return allProjects?.find((p) => p.id === sourceId) ?? project;
}

/** ★ Is this project reading somebody else's dates? Drives the note wording
 *  only — the arithmetic is the same either way. */
export function targetApprovalIsMirrored<
  T extends {
    id: string;
    redesign_of_project_id?: string | null;
    redesign_reuses_original_permit?: boolean | null;
  },
>(project: T | null | undefined, allProjects: readonly T[] | null | undefined): boolean {
  const src = targetApprovalDateSource(project, allProjects);
  return !!project && !!src && src.id !== project.id;
}

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
