// fix-383 — where all of a project's permits actually are.
//
// Bobby: "in the permit pills it would say, here's this project... okay,
// there's one in permitting, one in issued, two in design and engineering, one
// in correction. I would like the UI to bring that back — here's where all the
// permits are for this project from a high-level overview."
//
// ★★ IT EARNS ITS SPACE: of 174 projects on prod (2026-08-21), 100 (57%) have
// permits in more than one bucket and some span all four. Counting only
// UNISSUED permits it looks like 8% — the ISSUED ones are most of the value,
// which is exactly the case Bobby described.
//
// ---------------------------------------------------------------------------
// ★★★ THE SOURCE IS THE BUCKETS, NOT effectiveStage.
// ---------------------------------------------------------------------------
// The obvious implementation re-derives a stage per permit with
// effectiveStage(). This does not, and the difference matters: a count on the
// row is a CLICK TARGET, and a click has to land on a card that is really
// there. Deriving the stage independently lets the pill and the board disagree
// in three ways that all end in a dead click:
//
//   · bucketPermits splits D&E by the draw schedule, so a permit's column is
//     not a pure function of its own fields;
//   · hideIssuedAtAddress removes issued cards when EVERY permit at the
//     address is issued;
//   · a filter (fix-380 search, hold mode, self-scope, dash filters) can drop
//     permits before bucketing.
//
// Counting the bucketed cards makes the pill true by construction: "Iss 2"
// means there are exactly two Issued cards for this project on this board, so
// clicking it always finds them.
//
// ★★ THEREFORE THE COUNTS ARE OF THE *FILTERED* PIPELINE. With fix-380's
// search active, a project's pills describe what the search left behind, not
// its whole permit list. That is deliberate: a count that says 4 while the
// board can only show you 1 is its own small lie, and the click would break.
//
// ★ ISSUED IS INCLUDED. hideIssuedAtAddress only hides issued permits when
// every permit at the address is issued — i.e. the project is finished and has
// no row on the pipeline at all. Every project that still renders keeps its
// issued cards, which is precisely the cross-bucket case.

import type { Stage } from './database.types';
import type { BucketedPermits } from './permitStage';

export interface StageCount {
  stage: Stage;
  count: number;
}

/** Stable order, matching v1 :2792 and the left-to-right pipeline columns. */
export const STAGE_ORDER: Stage[] = ['de', 'pm', 'co', 'ap', 'is'];

/**
 * Which pipeline COLUMN holds a given stage. `co` (Corrections) is a
 * sub-column of Permitting, so it reveals through the `pm` group.
 */
export const STAGE_GROUP: Record<Stage, string> = {
  de: 'de',
  pm: 'pm',
  co: 'pm',
  ap: 'ap',
  is: 'is',
};

/**
 * One entry per address, listing how many of that project's cards sit in each
 * bucket. Zero-count stages are omitted rather than rendered as "0" — a stage
 * a project is not in is not news, and an unclickable 0 invites a click.
 *
 * ★ The two D&E sub-buckets (deEarly / deLate) collapse into one `de` count.
 * They are one column to the reader, and AddrGroup carries `stage="de"` in
 * both, so a `de` click reveals whichever of them holds the project.
 */
export function buildAddressDistribution(
  buckets: BucketedPermits,
  projectIdToAddress: Map<string, string>,
): Map<string, StageCount[]> {
  const tally = new Map<string, Map<Stage, number>>();

  const add = (projectId: string, stage: Stage) => {
    const address = projectIdToAddress.get(projectId);
    if (!address) return;
    const byStage = tally.get(address) ?? new Map<Stage, number>();
    byStage.set(stage, (byStage.get(stage) ?? 0) + 1);
    tally.set(address, byStage);
  };

  for (const p of buckets.deEarly) add(p.project_id, 'de');
  for (const p of buckets.deLate) add(p.project_id, 'de');
  for (const p of buckets.pm) add(p.project_id, 'pm');
  for (const p of buckets.co) add(p.project_id, 'co');
  for (const p of buckets.ap) add(p.project_id, 'ap');
  for (const p of buckets.is) add(p.project_id, 'is');

  const out = new Map<string, StageCount[]>();
  for (const [address, byStage] of tally) {
    out.set(
      address,
      STAGE_ORDER.filter((s) => (byStage.get(s) ?? 0) > 0).map((s) => ({
        stage: s,
        count: byStage.get(s) as number,
      })),
    );
  }
  return out;
}

/** True when a project's cards are spread over more than one bucket. */
export function spansMultipleBuckets(counts: StageCount[] | undefined): boolean {
  return (counts?.length ?? 0) > 1;
}
