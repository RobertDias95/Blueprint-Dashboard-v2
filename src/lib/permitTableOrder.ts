// ===========================================================================
// ★★★ fix-517 §C — THE PERMITS TABLE'S ORDER, AND THE ONE DECISION INSIDE IT
// ===========================================================================
//
// Bobby asked for **two orders that disagree**:
//
//   phase   — *"issue is at the bottom and then design and engineering is at
//             the top and then corrections is right below that and permitting
//             is kind of below that"*
//   urgency — *"the things that are most overdue are maybe towards the top"*
//
// ★★★ RULED: PHASE IS THE DEFAULT, URGENCY IS ONE CLICK. It is the mental
//     model the rail taught, and *issued at the bottom* is really "finished
//     things sink". Urgency is reached by clicking the `Schedule Health`
//     header — both orders, one default, and no new control.
//
// ★★★ AND THE PHASE ORDER IS NOT `STAGE_ORDER`. `lib/pipelineDistribution`'s
//     `STAGE_ORDER` is `de · pm · co · ap · is` — Permitting BEFORE
//     Corrections — and the deleted rail's phase groups read from it. Bobby's
//     words above put **Corrections above Permitting**, so this table declares
//     its own list. The two surfaces genuinely disagree now, on purpose: the
//     Pipeline's lanes are a funnel (a permit moves de → pm → co → ap), and
//     this table is a worklist (a permit in Corrections is the one wanting
//     attention today). Renaming either to match the other would lose one of
//     the two meanings, so the divergence is declared here rather than hidden.
//
// ★ `ap` (Approved — awaiting issuance) is not in Bobby's four. It sits
//   between Permitting and Issued, which is where "finished things sink" puts
//   it: approved is nearly done, and fix-221 already counts it as issued for
//   the on-track metric.
// ===========================================================================

import type { Stage } from './database.types';

/** The default top-to-bottom phase order for the Project Overview's PERMITS
 *  table. **Not** `STAGE_ORDER` — see the header note. */
export const PERMIT_TABLE_PHASE_ORDER: readonly Stage[] = [
  'de',
  'co',
  'pm',
  'ap',
  'is',
] as const;

/** Index of a stage in the table's phase order; unknown stages sort last. */
export function permitPhaseRank(stage: Stage): number {
  const i = PERMIT_TABLE_PHASE_ORDER.indexOf(stage);
  return i === -1 ? PERMIT_TABLE_PHASE_ORDER.length : i;
}

/**
 * The columns a header click can sort by. `default` is §C's phase order and is
 * what the table renders with no click — it is a real sort key rather than an
 * absence, so "click the sorted column a third time" can return to it.
 */
export type PermitSortKey =
  | 'default'
  | 'type'
  | 'num'
  | 'stage'
  | 'status'
  | 'source'
  | 'approval'
  | 'target'
  | 'health';

export type PermitSortDir = 'asc' | 'desc';

/**
 * ★★ THE FIRST CLICK ON A COLUMN GIVES THE ORDER SOMEBODY CLICKING IT WANTS.
 *
 * `Schedule Health` descending is the **overdue-first** view §C names as the
 * whole reason the headers are sortable at all; a first click that sorted it
 * ahead-first would need a second click to answer the question that prompted
 * the first. Dates ascend (soonest first) and text ascends (A→Z).
 */
export const PERMIT_SORT_FIRST_DIR: Record<PermitSortKey, PermitSortDir> = {
  default: 'asc',
  type: 'asc',
  num: 'asc',
  stage: 'asc',
  status: 'asc',
  source: 'asc',
  approval: 'asc',
  target: 'asc',
  health: 'desc',
};

/**
 * What the table needs to know about a permit in order to ORDER it. Built once
 * per render in `ScheduleHealthTable` from the same derivation the cells print,
 * so a sorted column can never disagree with the value under it — fix-512's
 * ruling ("one object, not two calls") applied to the sort as well as the cell.
 */
export interface PermitSortRow {
  id: number;
  /** The label the Permit Type cell prints, including a BP's nickname. */
  typeLabel: string;
  num: string | null;
  stage: Stage;
  statusLabel: string;
  /** `Learned (n)` / `Default` — the Data Source cell's word. */
  sourceLabel: string;
  /** The Permit Approval cell's date, ISO or null. */
  approvalIso: string | null;
  /** The Target Approval cell's date, ISO or null. */
  targetIso: string | null;
  /** Days behind target: positive = late. Null when either date is missing. */
  healthDiff: number | null;
  /** Position in `projects.permit_order`; `Number.MAX_SAFE_INTEGER` when this
   *  permit was never dragged. See `defaultComparePermits`. */
  orderRank: number;
  /** `actual_issue ?? approval_date`, for ordering the issued band. */
  issuedIso: string | null;
}

function cmpText(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * ★★★ fix-517 §0.2 — `projects.permit_order` IS STILL READ, AND THAT IS WHY
 *     DELETING THE RAIL DELETED NO PREFERENCE.
 *
 * STEP 0 found the rail's `⠿` handles were not decorative: order is persisted
 * in `projects.permit_order` (int[]) and **13 of 219 prod projects carry a
 * non-default one**. The rail's OUTER order was already phase and
 * `permit_order` was only the tiebreak WITHIN a phase (ProjectDetail.tsx, the
 * deleted `activeSorted` / `activeGroups` pair) — which is exactly the shape
 * §C rules for this table. So the column is not dropped, no row is rewritten,
 * and all 13 projects keep the order they set.
 *
 * ★★ WHAT DID GO IS THE ABILITY TO RE-DRAG, because a sortable table and a
 *    manual drag order fight each other: a click on a header would silently
 *    discard the drag, or the drag would silently discard the sort. That is
 *    reversible — the data is intact — and it is called out rather than
 *    absorbed.
 */
export function defaultComparePermits(a: PermitSortRow, b: PermitSortRow): number {
  const pa = permitPhaseRank(a.stage);
  const pb = permitPhaseRank(b.stage);
  if (pa !== pb) return pa - pb;
  // ★ The issued band keeps the rail's own rule: most-recently-issued first,
  //   which is fix-65's ordering and is NOT permit_order (v1 kept issued
  //   permits as a static bottom block that dragging could not reach).
  if (a.stage === 'is') {
    const da = a.issuedIso ?? '';
    const db = b.issuedIso ?? '';
    if (da !== db) return db.localeCompare(da);
    return b.id - a.id;
  }
  if (a.orderRank !== b.orderRank) return a.orderRank - b.orderRank;
  return a.id - b.id;
}

/**
 * ★★ A MISSING VALUE SORTS LAST IN BOTH DIRECTIONS.
 *
 * 26 of 685 permits have no number and a permit with no projection has no
 * approval date; flipping the direction must not float those to the top. An
 * empty cell is not "the smallest value", it is "no answer", and no answer is
 * never the thing you clicked a column to see.
 */
function withNullsLast(
  cmp: number,
  aNull: boolean,
  bNull: boolean,
  dir: PermitSortDir,
): number {
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  return dir === 'asc' ? cmp : -cmp;
}

export function sortPermitRows<T extends PermitSortRow>(
  rows: readonly T[],
  key: PermitSortKey,
  dir: PermitSortDir,
): T[] {
  const out = [...rows];
  if (key === 'default') {
    out.sort(defaultComparePermits);
    return out;
  }
  out.sort((a, b) => {
    let r = 0;
    switch (key) {
      case 'type':
        r = withNullsLast(cmpText(a.typeLabel, b.typeLabel), false, false, dir);
        break;
      case 'num':
        r = withNullsLast(
          cmpText(a.num ?? '', b.num ?? ''),
          !a.num,
          !b.num,
          dir,
        );
        break;
      case 'stage':
        r = withNullsLast(
          permitPhaseRank(a.stage) - permitPhaseRank(b.stage),
          false,
          false,
          dir,
        );
        break;
      case 'status':
        r = withNullsLast(cmpText(a.statusLabel, b.statusLabel), false, false, dir);
        break;
      case 'source':
        r = withNullsLast(cmpText(a.sourceLabel, b.sourceLabel), false, false, dir);
        break;
      case 'approval':
        r = withNullsLast(
          (a.approvalIso ?? '').localeCompare(b.approvalIso ?? ''),
          !a.approvalIso,
          !b.approvalIso,
          dir,
        );
        break;
      case 'target':
        r = withNullsLast(
          (a.targetIso ?? '').localeCompare(b.targetIso ?? ''),
          !a.targetIso,
          !b.targetIso,
          dir,
        );
        break;
      case 'health':
        r = withNullsLast(
          (a.healthDiff ?? 0) - (b.healthDiff ?? 0),
          a.healthDiff === null,
          b.healthDiff === null,
          dir,
        );
        break;
      // ★ No `default`: `key` is a closed union and every member is handled
      //   above, so a default branch would be unreachable and lint says so.
    }
    // ★ Every sort falls back to the DEFAULT order, not to insertion order, so
    //   two permits with the same status still read phase-first underneath.
    return r !== 0 ? r : defaultComparePermits(a, b);
  });
  return out;
}
