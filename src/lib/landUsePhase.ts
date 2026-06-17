import type { Permit, PermitCycle } from './database.types';
import { isTerminalPositiveStatus } from './permitTerminalStatus';

// fix-169: land-use (LU) phase model — Fix B foundation.
//
// Seattle land-use records (*-LU: ULS / LBA / short-plat) have a MIDDLE PHASE
// the cycle layer doesn't model: after the initial review cycles complete the
// record moves through Design Review → Decision Published → a ~2-week public
// publication window, then final reviews RESUME the cycle history, then it's
// Recorded/Issued. Bobby's model captures that middle phase as MILESTONE DATES
// (permits.design_review_date / decision_published_date / publication_end_date)
// plus a derived phase badge — NOT new cycles.
//
// This deriver is "one model, phases optional": a subtype that skips a phase
// just leaves that milestone NULL, and the deriver returns the FURTHEST phase
// reached. It mirrors effectiveStage's precedence-chain style (check the most
// advanced signal first, fall back through the cycle layer). The milestone
// columns stay NULL until the scraper populates them (fix-78); until then the
// badge falls back to the cycle-derived phase (Intake / In Review / Corrections).

export type LandUsePhase =
  | 'intake'
  | 'in_review'
  | 'corrections'
  | 'design_review'
  | 'in_publication'
  | 'decision_published'
  | 'final_review'
  | 'recorded';

export const LAND_USE_PHASE_LABEL: Record<LandUsePhase, string> = {
  intake: 'Intake',
  in_review: 'In Review',
  corrections: 'Corrections',
  design_review: 'Design Review',
  in_publication: 'In Publication',
  decision_published: 'Decision Published',
  final_review: 'Final Review',
  recorded: 'Recorded',
};

// fix-178: the "limbo" phases the cycle/stage tracker does NOT already cover.
// The badge surfaces ONLY these — Design Review, the publication window (In
// Publication / Decision Published) — so it stops duplicating info the cycle
// layer already shows (Intake / In Review / Corrections) and stops cluttering
// terminal/final states (Final Review / Recorded). Pure display gate; the
// deriver still returns the full phase for any other consumer.
export const LAND_USE_LIMBO_PHASES: ReadonlySet<LandUsePhase> = new Set<LandUsePhase>([
  'design_review',
  'decision_published',
  'in_publication',
]);

/** fix-178: true when the phase is one the badge should surface (limbo only). */
export function isLandUseLimboPhase(phase: LandUsePhase): boolean {
  return LAND_USE_LIMBO_PHASES.has(phase);
}

/** Land-use permit subtypes. ULS is the in-codebase Seattle LU type (also a
 *  NO_ISSUANCE type); LBA + short-plat are the other *-LU subtypes (scraper
 *  fix-77). A Seattle land-use record number ends in '-LU', so we also match
 *  that suffix to stay subtype-agnostic. */
export const LAND_USE_PERMIT_TYPES: ReadonlySet<string> = new Set([
  'ULS',
  'LBA',
  'Short Plat',
  'Short-Plat',
]);

export function isLandUsePermit(
  permit: { type?: string | null; num?: string | null } | null | undefined,
): boolean {
  if (!permit) return false;
  if (LAND_USE_PERMIT_TYPES.has((permit.type ?? '').trim())) return true;
  return /-LU$/i.test((permit.num ?? '').trim());
}

export interface LandUsePhaseResult {
  phase: LandUsePhase;
  /** Display label (LAND_USE_PHASE_LABEL[phase]). */
  label: string;
  /** The milestone/cycle date most relevant to this phase, or null. */
  date: string | null;
  /** Set ONLY for `in_publication` — the publication-window close. The badge
   *  renders "In Publication until <until>". Null otherwise. */
  until: string | null;
}

type PermitLike = Pick<
  Permit,
  | 'type'
  | 'num'
  | 'status'
  | 'actual_issue'
  | 'approval_date'
  | 'intake_date'
  | 'design_review_date'
  | 'decision_published_date'
  | 'publication_end_date'
>;

export interface DeriveLandUsePhaseInput {
  permit: PermitLike;
  cycles: PermitCycle[];
  /** Override for deterministic tests. Defaults to today @ local midnight. */
  today?: Date;
}

function toMidnight(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  return m;
}

/** Parse 'YYYY-MM-DD' as local-noon (tz-drift-safe). Null when unparseable. */
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function result(
  phase: LandUsePhase,
  date: string | null,
  until: string | null = null,
): LandUsePhaseResult {
  return { phase, label: LAND_USE_PHASE_LABEL[phase], date, until };
}

/**
 * Derive the land-use phase for a permit, or null when the permit isn't a
 * land-use record. Precedence (most-advanced first — the badge shows the
 * furthest phase reached):
 *   Recorded/Issued  → actual_issue / approval_date / terminal-positive status
 *   Final Review     → decision published AND a review cycle submitted after
 *                      the publication window (cycle history resumes)
 *   In Publication   → decision_published set AND today ≤ publication_end_date
 *   Decision Published → decision_published set (window closed / no end date)
 *   Design Review    → design_review_date set, no decision yet
 *   Corrections      → a cycle has corr_issued && !resubmitted
 *   In Review        → a cycle has a submitted date
 *   Intake           → otherwise (intake_date / intake_accepted, or nothing yet)
 */
export function deriveLandUsePhase(
  input: DeriveLandUsePhaseInput,
): LandUsePhaseResult | null {
  const p = input.permit;
  if (!isLandUsePermit(p)) return null;

  const today = toMidnight(input.today ?? new Date());
  const cycles = input.cycles ?? [];

  // 1. Recorded / Issued — terminal positive wins outright.
  if (p.actual_issue) return result('recorded', p.actual_issue);
  if (p.approval_date) return result('recorded', p.approval_date);
  if (isTerminalPositiveStatus(p.status ?? null)) return result('recorded', null);

  // 2. Final Review — the decision has published and a review cycle has resumed
  //    (a cycle submitted AFTER the publication window / decision). The cycle
  //    layer carries the correction detail; the badge just flags the phase.
  if (p.decision_published_date) {
    const afterRaw = p.publication_end_date ?? p.decision_published_date;
    const after = parseDate(afterRaw);
    let finalSubmitted: string | null = null;
    if (after) {
      for (const c of cycles) {
        const sub = parseDate(c.submitted);
        if (sub && sub.getTime() > after.getTime()) {
          if (!finalSubmitted || (c.submitted ?? '') > finalSubmitted) {
            finalSubmitted = c.submitted ?? null;
          }
        }
      }
    }
    if (finalSubmitted) return result('final_review', finalSubmitted);

    // 3. In Publication vs Decision Published.
    const end = parseDate(p.publication_end_date);
    if (end && today.getTime() <= end.getTime()) {
      return result(
        'in_publication',
        p.decision_published_date,
        p.publication_end_date ?? null,
      );
    }
    return result('decision_published', p.decision_published_date);
  }

  // 4. Design Review — design review reached, no decision yet.
  if (p.design_review_date) return result('design_review', p.design_review_date);

  // 5/6. Cycle state — Corrections beats In Review. Walk most-recent first so
  //      the date shown is the latest relevant one.
  const sorted = [...cycles].sort((a, b) => b.cycle_index - a.cycle_index);
  for (const c of sorted) {
    if (c.corr_issued && !c.resubmitted) return result('corrections', c.corr_issued);
  }
  for (const c of sorted) {
    if (c.submitted) return result('in_review', c.submitted);
  }

  // 7. Intake — nothing submitted yet.
  const intakeDate =
    p.intake_date ??
    sorted.find((c) => c.intake_accepted)?.intake_accepted ??
    null;
  return result('intake', intakeDate);
}
