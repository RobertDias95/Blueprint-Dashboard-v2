import type { PermitCycle, PermitCycleReviewer } from './database.types';
import { bucketStatus } from './reviewerRollup';
import { estimateBasisText, usableCityTarget, usDay } from './reviewerDueEstimate';
import type { ReviewerEstimate } from './reviewerDueEstimate';

// ===========================================================================
// ★★★ fix-651 (P-340) — "CITY TARGET" IS THE OPEN ROUND'S DATE, NEVER A
//     CLOSED ROUND'S
// ===========================================================================
//
// Bobby, 2026-10-12, on 10431 SE 19th St: *"a discrepancy between the project
// screen city target date and the permits reviewers target date"*. The board
// card said CITY TARGET 2026-08-05 (red); the reviewer pop-up said ~Due
// 10/14/2026 (est.).
//
// ★★★ THE CAUSE: the board took the LATEST `city_target` ACROSS ALL CYCLES (a
//     v1 port). Cycle 2 had one — a round that closed with corrections on
//     08-14 — and the open cycle 4 had none, so the board showed the closed
//     round's date and painted it red for two months.
//
// ★★★ THE RULE, one helper for every surface that means "the open round":
//   1. the open round's `city_target`, if set;
//   2. else the LATEST due date among that round's OPEN reviewers — the city's
//      date where usable, else fix-640's estimate (the same source and the
//      same `usableCityTarget` test the pop-up uses), flagged `estimated` when
//      any open reviewer's date is an estimate;
//   3. else nothing.
//   Never a closed round's date.
//
// ★ The open round is the permit's CURRENT cycle — the highest cycle_index,
//   the same choice as `currentCycleIndex` (fix-186) and the chase minter's
//   `DISTINCT ON … cycle_index DESC`.
//
// ★ The LATEST reviewer date, not the earliest: the round is finished when the
//   last discipline answers, so that is when the city's answer is due.

export interface OpenRoundCityTarget {
  /** YYYY-MM-DD */
  date: string;
  /** True when the date comes from reviewers and any of them is an estimate. */
  estimated: boolean;
  /** Where the date came from. */
  source: 'cycle' | 'reviewers';
  /** The open round's cycle_index. */
  cycleIndex: number;
  /** Tooltip for a reviewer-derived date: one line per open reviewer. */
  basis: string | null;
}

type CycleLike = Pick<PermitCycle, 'cycle_index' | 'city_target'>;
type ReviewerLike = Pick<
  PermitCycleReviewer,
  'id' | 'cycle_index' | 'current_status' | 'last_event_date' | 'reviewer_name' | 'discipline'
> & { target_date?: string | null };

function isoDay(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** The permit's open round — its highest cycle_index — or null. */
export function openRoundIndex(cycles: ReadonlyArray<CycleLike>): number | null {
  if (cycles.length === 0) return null;
  return cycles.reduce((m, c) => (c.cycle_index > m ? c.cycle_index : m), cycles[0]!.cycle_index);
}

/** An open reviewer — the pop-up's own test (in review or pending). */
function isOpenReviewer(r: Pick<PermitCycleReviewer, 'current_status'>): boolean {
  const b = bucketStatus(r.current_status);
  return b === 'in_review' || b === 'pending';
}

/**
 * The reviewer ids on the open round that need an estimate: open, and with no
 * usable city date. Only asked when the open round itself has no city_target —
 * otherwise rule 1 answers and no estimate is read.
 */
export function openRoundEstimateIds(
  cycles: ReadonlyArray<CycleLike>,
  reviewers: ReadonlyArray<ReviewerLike>,
): string[] {
  const idx = openRoundIndex(cycles);
  if (idx === null) return [];
  const cyc = cycles.find((c) => c.cycle_index === idx);
  if (isoDay(cyc?.city_target)) return [];
  return reviewers
    .filter((r) => r.cycle_index === idx && isOpenReviewer(r))
    .filter((r) => !usableCityTarget(r.target_date, r.last_event_date))
    .map((r) => r.id);
}

/** ★★★ The one rule. See the header. */
export function openRoundCityTarget(
  cycles: ReadonlyArray<CycleLike>,
  reviewers: ReadonlyArray<ReviewerLike> = [],
  estimates?: ReadonlyMap<string, ReviewerEstimate>,
): OpenRoundCityTarget | null {
  const idx = openRoundIndex(cycles);
  if (idx === null) return null;
  const cyc = cycles.find((c) => c.cycle_index === idx);

  // 1. The open round's own city_target.
  const own = isoDay(cyc?.city_target);
  if (own) return { date: own, estimated: false, source: 'cycle', cycleIndex: idx, basis: null };

  // 2. The latest due date among the open round's open reviewers.
  let latest: string | null = null;
  let estimated = false;
  const lines: string[] = [];
  for (const r of reviewers) {
    if (r.cycle_index !== idx || !isOpenReviewer(r)) continue;
    const who = (r.reviewer_name ?? '').trim() || (r.discipline ?? '').trim() || 'Reviewer';
    const city = usableCityTarget(r.target_date, r.last_event_date);
    if (city) {
      lines.push(`${who}: due ${usDay(city)} (city)`);
      if (!latest || city > latest) latest = city;
      continue;
    }
    const e = estimates?.get(r.id);
    const est = isoDay(e?.estimated_due);
    if (!e || !est) continue;
    estimated = true;
    lines.push(`${who}: ~due ${usDay(est)} (est.) — ${estimateBasisText(e)}`);
    if (!latest || est > latest) latest = est;
  }
  if (!latest) return null;
  return {
    date: latest,
    estimated,
    source: 'reviewers',
    cycleIndex: idx,
    basis:
      `Cycle ${idx} has no city target — latest open reviewer due date.\n` + lines.join('\n'),
  };
}

/** How the board writes it: `2026-08-05`, or `~2026-10-15 (est.)`. */
export function openRoundCityTargetText(t: OpenRoundCityTarget | null): string | null {
  if (!t) return null;
  return t.estimated ? `~${t.date} (est.)` : t.date;
}
