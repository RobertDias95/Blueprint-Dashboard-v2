import { TERMINAL_POSITIVE_STATUSES } from './permitTerminalStatus';

// ===========================================================================
// ★★★ fix-388 — THE CITY ANSWERED "HAS THE SET GONE IN?" AND NOBODY READ IT
// ===========================================================================
//
// Bobby: "i think i noticed some outdated milestones on miles myboard, but i
// could be wrong." He was right.
//
// ★★★ THE MECHANISM. `everSubmitted(cycles)` asks whether any permit_cycles row
// carries a `submitted` date. For building permits the scraper fills those in,
// so it works. FOR LAND USE IT NEVER DOES — LU runs a different lifecycle and
// its cycles are a known open scraper item — so `everSubmitted` is false
// FOREVER on a ULS, and every pre-submission milestone fires from the day the
// target passes until approval. Years of "Nd past target" on permits the city
// is actively reviewing. Miles carries the LU book, which is why it was his
// board.
//
// ★★ Measured on prod 2026-08-22: 38 unissued permits sit at "Additional Info
// Requested" (37 of them ULS) and 36 of those have no submitted date on any
// cycle — 16 raising a live target chip and 18 a live draw chip. The city
// cannot request additional information on an application it does not have.
//
// ★★ The scraper already wrote the answer, into permits.status. The board just
// never read it. Teaching the scraper to emit LU cycles is a real ticket, and a
// cross-repo one; this makes the board believe the answer it already has.
//
// ---------------------------------------------------------------------------
// ★★★ AN ENUMERATED CLOSED SET. NEVER A SUBSTRING TEST.
// ---------------------------------------------------------------------------
//
// Status vocabulary is scraper output and jurisdiction-specific. A fuzzy match
// here — /review|correct/ — is how a future status quietly flips two hundred
// chips with nobody reviewing the change. Every value below was read off prod
// and classified one at a time, and anything ambiguous was deliberately LEFT
// OUT.
//
// ★★★ THE DEFAULT IS "NEITHER", AND IT IS ASYMMETRIC ON PURPOSE. A status not
// listed here keeps its chips firing. A false prompt is recoverable — somebody
// sees it and it is annoying. A silently killed TRUE prompt is not: nobody ever
// learns the thing they needed to know. So an unsure status errs toward noise.
//
// ---------------------------------------------------------------------------
// ★★ THE THREE THAT ARE DELIBERATELY ABSENT, AND WHY
// ---------------------------------------------------------------------------
//
//   'Ready for Intake'  — ★ BOOKED IS NOT SUBMITTED. Intake is the appointment
//                         at which the set is handed over; "ready for" it is
//                         the state before that happens. 14 unissued permits,
//                         3 of them with no submitted date — those 3 keep
//                         asking, correctly.
//   'Scheduled'         — ★ the same shape: a slot in a calendar, not a
//                         delivery. 5 unissued, 3 unsubmitted, all keep asking.
//   'Initiated'         — ambiguous. "Initiated" reads as started, which is
//                         what you are before you file, not after. 3 unissued,
//                         1 unsubmitted, keeps asking.
//
// Also absent, and unambiguously right to be: 'Pre-Submittal — GO' and
// 'Pre-Submittal — Kickoff'. These are the TRUE positives — 30 unissued permits
// with no submitted date, 29 of them raising a live target chip today. The
// whole point of enumerating rather than guessing is that this fix kills the
// false chips and does not touch one of these.
//
// ★ Left out for ambiguity, affecting nothing today (every permit carrying them
// already has a submitted date, so the classification changes no behaviour):
// 'In Process', 'Application Completed', 'Document Required'. Listed here so
// the next person knows they were considered rather than missed.

/**
 * ★★★ Statuses that PROVE the application reached the city.
 *
 * Read as: "the city could not be saying this unless it had the set."
 */
export const STATUS_PROVES_SUBMITTED: ReadonlySet<string> = new Set([
  // ★★★ The 36-permit case. The city has reviewed the application and asked
  // for more — it cannot do that without the application.
  'Additional Info Requested',
  // The corrections family. fix-214's isPermitInCorrections already treats
  // these three as "in corrections", which is a state only reachable after
  // review, and review only happens after filing.
  'Corrections Required',
  'Awaiting Information',
  'Awaiting Corrections',
  // Under review, in every spelling the portals use.
  'Reviews In Process',
  'Reviews Completed',
  'In Review',
  'Under Review',
  // Land use publication — a LU application is published for comment after it
  // is accepted, never before.
  'Published',
  'Ready for Publication',
  // Filed, in as many words.
  'Applied',
  // Approved with a condition attached; approval implies filing.
  'Approved - Additional Information',
  // Issuance is pending, which is downstream of everything.
  'Ready To Issue',
  // ★★ And every terminal-POSITIVE status by construction (Approved,
  // Conceptually Approved, Issued, Completed, Closed, Ready for Issuance): a
  // permit the city has finished with was self-evidently submitted. Composed
  // from permitTerminalStatus.ts rather than re-typed, so the two sets cannot
  // drift apart.
  ...TERMINAL_POSITIVE_STATUSES,
]);

/**
 * ★★★ Does this status prove the set has gone in?
 *
 * Used for exactly the two milestone kinds whose question is "has the set gone
 * in" — `target_submit` and `draw`. It is deliberately NOT wired to `intake`,
 * which asks a different question (has the city ACCEPTED intake) and keys on
 * `intake_accepted`. Nothing in the prod vocabulary proves intake acceptance
 * specifically: 'Ready for Intake' is the state before it, and every status
 * that comes after intake also comes after a dozen other things, so it would
 * be inferring a precise event from a coarse one.
 *
 * Exact match after trimming. Whitespace-tolerant like its siblings in
 * permitTerminalStatus.ts; case-sensitive on purpose, because the scraper
 * writes these strings verbatim and a case difference means a NEW status
 * somebody should look at rather than one to silently absorb.
 */
export function statusImpliesSubmitted(
  permitStatus: string | null | undefined,
): boolean {
  if (!permitStatus) return false;
  return STATUS_PROVES_SUBMITTED.has(permitStatus.trim());
}
